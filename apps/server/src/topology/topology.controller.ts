import { Controller, Get } from '@nestjs/common';
import { TopologyService } from './topology.service';

@Controller('api/v1/topology')
export class TopologyController {
  constructor(private readonly topologyService: TopologyService) {}

  @Get('graph-data')
  async getGraphData() {
    return this.topologyService.getGraphData();
  }
}
