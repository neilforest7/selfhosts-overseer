import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, Action, OperationLog, TriggerType } from '@prisma/client';
import { TasksService } from '../tasks/tasks.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { HostsService } from '../hosts/hosts.service';
import { ContainersService } from '../containers/containers.service';

@Injectable()
export class ActionsService {
  constructor(
    private prisma: PrismaService,
    private tasksService: TasksService,
    private operationLogService: OperationLogService,
    private hostsService: HostsService,
    @Inject(forwardRef(() => ContainersService))
    private containersService: ContainersService,
  ) {}

  async create(data: Prisma.ActionCreateInput): Promise<Action> {
    return this.prisma.action.create({ data });
  }

  async findAll(): Promise<Action[]> {
    return this.prisma.action.findMany({
      orderBy: { createdAt: 'desc' },
      include: { triggers: true, notifications: true },
    });
  }

  async findOne(id: string): Promise<Action> {
    const action = await this.prisma.action.findUnique({
      where: { id },
      include: { triggers: true, notifications: true },
    });
    if (!action) {
      throw new NotFoundException(`Action with ID "${id}" not found`);
    }
    return action;
  }

  async update(id: string, data: Prisma.ActionUpdateInput): Promise<Action> {
    return this.prisma.action.update({ where: { id }, data });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.action.delete({ where: { id } });
  }

  async runManually(id: string, triggerType: TriggerType = 'USER'): Promise<OperationLog> {
    const action = await this.findOne(id);
    const opLog = await this.operationLogService.create({
      title: `${triggerType === 'USER' ? 'Manual Run' : 'Scheduled Run'}: ${action.name}`,
      triggerType,
      context: { actionId: action.id, payload: action.taskPayload },
    });

    this.dispatchAndRun(opLog.id, action);
    return opLog;
  }

  private async dispatchAndRun(opId: string, action: Action): Promise<void> {
    try {
      const payload = action.taskPayload as any;
      if (!payload) throw new Error('Action payload is missing or invalid.');

      switch (action.taskType) {
        case 'EXEC_COMMAND':
          if (!payload.command || !Array.isArray(payload.targetHostIds)) throw new Error('Payload for EXEC_COMMAND is invalid.');
          await this.tasksService.exec({ opId, command: payload.command, targets: payload.targetHostIds });
          break;

        case 'DISCOVER_CONTAINERS':
          if (!payload.hostId) throw new Error('Payload for DISCOVER_CONTAINERS is missing hostId.');
          console.log(`[ActionRunner] Preparing to discover containers for hostId: ${payload.hostId}`);
          const fullHost = await this.hostsService.findOne(payload.hostId, true);
          // discoverOnHost is now self-contained and handles its own completion status.
          await this.containersService.discoverOnHost(fullHost, opId);
          break;
        
        case 'CHECK_HOST_HEALTH':
          if (!Array.isArray(payload.targetHostIds)) throw new Error('Payload for CHECK_HOST_HEALTH is invalid.');
          for (const hostId of payload.targetHostIds) {
            const result = await this.hostsService.testConnection(hostId);
            await this.operationLogService.addLogEntry(opId, { stream: 'system', content: `Host ${hostId} health check: ${result.ok ? 'OK' : 'Failed'}`, hostId });
          }
          await this.operationLogService.updateStatus(opId, 'COMPLETED');
          break;

        default:
          throw new Error(`Unknown action type: ${action.taskType}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[ActionRunner] Error executing action ${action.id} (Op: ${opId}):`, err);
      await this.operationLogService.log(opId, 'error', errorMessage);
      await this.operationLogService.updateStatus(opId, 'ERROR');
    }
  }
}