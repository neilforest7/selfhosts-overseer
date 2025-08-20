
import { Controller, Post, Body, HttpCode, Logger } from '@nestjs/common';
import { DiunService } from './diun.service';
import { CheckImageDto } from './dto/check-image.dto';

// DTO for Diun webhook payload validation (basic structure)
class DiunWebhookDto {
  hostname?: string;
  entries?: any[];
}

@Controller('diun')
export class DiunController {
  private readonly logger = new Logger(DiunController.name);

  constructor(private readonly diunService: DiunService) {}

  @Post('notify')
  @HttpCode(204) // Respond with "204 No Content" for successful notifications
  async handleDiunWebhook(@Body() payload: DiunWebhookDto): Promise<void> {
    this.logger.log(
      `Received Diun webhook notification with ${
        payload.entries?.length ?? 0
      } entries.`,
    );
    try {
      await this.diunService.processWebhookPayload(payload.entries || []);
    } catch (error) {
      this.logger.error('Failed to process Diun webhook payload.', error);
      // Don't rethrow, as Diun might retry. Logging is sufficient.
    }
  }

  @Post('check-image')
  @HttpCode(202) // Respond with "202 Accepted" as the check is async
  async checkSingleImage(@Body() checkImageDto: CheckImageDto) {
    this.logger.log(`Received request to check image: ${checkImageDto.image}`);
    // Don't await, let it run in the background
    this.diunService.checkSingleImage(checkImageDto.image).catch((err) => {
      this.logger.error(
        `Error during single image check for ${checkImageDto.image}`,
        err,
      );
    });
    return {
      message: `Check initiated for ${checkImageDto.image}. If an update is found, a notification will be processed.`,
    };
  }
}
