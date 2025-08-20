import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Container } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as yaml from 'js-yaml';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';

const execAsync = promisify(exec);

@Injectable()
export class DiunService {
  private readonly logger = new Logger(DiunService.name);
  private readonly diunBinaryPath = path.join(
    __dirname,
    '..',
    '..',
    'bin',
    'diun',
  );
  private readonly diunConfigPath = path.join(
    __dirname,
    '..',
    '..',
    'config',
    'diun.yml',
  );
  private readonly diunImagesPath = path.join(
    __dirname,
    '..',
    '..',
    'config',
    'diun-images.yml',
  );

  constructor(private readonly prisma: PrismaService) {}

  async checkUpdatesForHost(hostId: string): Promise<number> {
    const containers = await this.prisma.container.findMany({
      where: { hostId, imageName: { not: null } },
    });

    if (containers.length === 0) {
      this.logger.log(`No containers with images found for host ${hostId}`);
      return 0;
    }

    await this.prisma.container.updateMany({
      where: {
        id: {
          in: containers.map((c) => c.id),
        },
      },
      data: {
        updateAvailable: false,
      },
    });

    await this.generateConfig(containers);
    await this.runDiunBinary();

    this.logger.log(
      `Diun update check initiated for host ${hostId}. Results will be processed via webhook.`, 
    );
    return 0;
  }

  /**
   * Initiates a one-off Diun check for a single container image using a temporary Docker container.
   * The result is sent back to the application's own webhook.
   * @param image - The full image name with tag (e.g., "nginx:latest").
   */
  async checkSingleImage(image: string): Promise<void> {
    const webhookUrl =
      process.env.INTERNAL_API_URL || 'http://127.0.0.1:3000/api/diun/notify';
    const tempFileName = `diun-check-${randomBytes(6).toString('hex')}.yml`;
    const tempFilePath = path.join(tmpdir(), tempFileName);

    const tempConfig = {
      log: {
        level: 'info',
      },
      watch: {
        runOnStartup: true,
        schedule: '0 0 1 1 *', // Run once a year, effectively only on startup
      },
      notifs: {
        webhook: {
          endpoint: webhookUrl,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      },
      providers: {
        static: [
          {
            name: image,
            // We find the container by image name, so no special label is needed here
          },
        ],
      },
    };

    try {
      const yamlContent = yaml.dump(tempConfig);
      await fs.writeFile(tempFilePath, yamlContent);
      this.logger.debug(`Created temporary diun config at ${tempFilePath}`);

      // The command to run a one-off, self-cleaning diun container
      // --network=host is used to ensure the diun container can reach the webhook URL of the main app
      const command = `docker run --rm \
        --network=host \
        -v ${tempFilePath}:/diun.yml \
        -v /var/run/docker.sock:/var/run/docker.sock \
        crazymax/diun:latest`;

      this.logger.log(`Executing one-off diun check: ${command}`);
      const { stdout, stderr } = await execAsync(command);

      if (stdout) this.logger.log(`[Diun-Once STDOUT] ${stdout}`);
      if (stderr) this.logger.warn(`[Diun-Once STDERR] ${stderr}`);
    } catch (error) {
      this.logger.error(`Failed to execute one-off diun check for ${image}`, error);
      throw error; // Rethrow to be caught by the controller
    } finally {
      // Cleanup the temporary file
      try {
        await fs.unlink(tempFilePath);
        this.logger.debug(`Cleaned up temporary diun config: ${tempFilePath}`);
      } catch (cleanupError) {
        this.logger.warn(`Failed to clean up temp file ${tempFilePath}`, cleanupError);
      }
    }
  }

  private async generateConfig(containers: Container[]): Promise<void> {
    const imageList = containers.map((c) => ({
      name: `${c.imageName}:${c.imageTag || 'latest'}`, 
      labels: {
        'diun.provider': c.id, // Pass our internal ID through labels
      },
    }));

    const webhookUrl =
      process.env.INTERNAL_API_URL || 'http://127.0.0.1:3000/api/diun/notify';

    const mainConfig = {
      watch: {
        workers: 10,
        schedule: '0 * * * *',
        runOnStartup: false,
      },
      notif: {
        webhook: {
          endpoint: webhookUrl,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeout: '10s',
        },
      },
      providers: {
        file: {
          filename: this.diunImagesPath,
        },
      },
    };

    const mainYamlContent = yaml.dump(mainConfig);
    const imagesYamlContent = yaml.dump(imageList);

    await fs.mkdir(path.dirname(this.diunConfigPath), { recursive: true });
    await fs.writeFile(this.diunConfigPath, mainYamlContent);
    await fs.writeFile(this.diunImagesPath, imagesYamlContent);

    this.logger.log(`Generated diun config at ${this.diunConfigPath}`);
    this.logger.log(`Generated diun images file at ${this.diunImagesPath}`);
  }

  private async runDiunBinary(): Promise<void> {
    const command = this.diunBinaryPath;
    const args = ['serve', '--config', this.diunConfigPath];

    this.logger.log(`Spawning diun process: ${command} ${args.join(' ')}`);

    try {
      const diunProcess = spawn(command, args);

      diunProcess.stdout.on('data', (data) => {
        const message = data.toString('utf8').trim();
        this.logger.log(`[Diun STDOUT] ${message}`);
      });

      diunProcess.stderr.on('data', (data) => {
        const message = data.toString('utf8').trim();
        this.logger.error(`[Diun STDERR] ${message}`);
      });

      diunProcess.on('close', (code) => {
        this.logger.log(`Diun process exited with code ${code}`);
      });

      diunProcess.on('error', (err) => {
        this.logger.error('Failed to start Diun process.', err);
      });
    } catch (error) {
      this.logger.error('Failed to spawn diun binary process', error);
      throw error;
    }
  }

  async processWebhookPayload(entries: any[]): Promise<number> {
    if (!Array.isArray(entries)) {
      this.logger.warn('Received webhook payload with no entries array.');
      return 0;
    }

    let updatedCount = 0;
    for (const entry of entries) {
      if (entry.status === 'update') {
        const containerId = entry.image.labels?.['diun.provider'];
        if (containerId) {
          // This is for host-based checks
          try {
            await this.prisma.container.update({
              where: { id: containerId },
              data: {
                updateAvailable: true,
                remoteDigest: entry.image.digest,
                updateCheckedAt: new Date(),
              },
            });
            updatedCount++;
            this.logger.log(
              `Marked container ${containerId} as having an update available.`, 
            );
          } catch (e: any) {
            this.logger.warn(
              `Could not update container ${containerId} from webhook: ${e.message}`, 
            );
          }
        } else {
          // This is for single image checks, where we don't have a container ID
          const imageName = entry.image.name.split(':')[0];
          const imageTag = entry.image.name.split(':')[1] || 'latest';
          try {
            const updated = await this.prisma.container.updateMany({
              where: { imageName, imageTag },
              data: {
                updateAvailable: true,
                remoteDigest: entry.image.digest,
                updateCheckedAt: new Date(),
              },
            });
            if (updated.count > 0) {
              updatedCount += updated.count;
              this.logger.log(
                `Marked ${updated.count} container(s) with image ${entry.image.name} as having an update available.`, 
              );
            }
          } catch (e: any) {
            this.logger.warn(
              `Could not update containers for image ${entry.image.name} from webhook: ${e.message}`, 
            );
          }
        }
      }
    }

    this.logger.log(
      `Processed Diun webhook. Found ${updatedCount} updates.`, 
    );
    return updatedCount;
  }
}