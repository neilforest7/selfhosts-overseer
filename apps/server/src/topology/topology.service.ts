import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Container,
  FrpcProxy,
  FrpsConfig,
  Host,
  ReverseProxyRoute,
} from '@prisma/client';

// Define Cytoscape.js compatible types
interface CyElement {
  group: 'nodes' | 'edges';
  data: {
    id: string;
    label?: string;
    parent?: string;
    source?: string;
    target?: string;
    [key: string]: any;
  };
  style?: object;
}

@Injectable()
export class TopologyService {
  private readonly logger = new Logger(TopologyService.name);
  constructor(private readonly prisma: PrismaService) {}

  async getGraphData(): Promise<CyElement[]> {
    this.logger.log('Fetching data for topology graph...');
    const [hosts, containers, routes, frpsConfigs, frpcProxies] =
      await Promise.all([
        this.prisma.host.findMany(),
        this.prisma.container.findMany(),
        this.prisma.reverseProxyRoute.findMany(),
        this.prisma.frpsConfig.findMany(),
        this.prisma.frpcProxy.findMany(),
      ]);
    this.logger.log(
      `Fetched ${hosts.length} hosts, ${containers.length} containers, ${routes.length} routes, ${frpsConfigs.length} frps, ${frpcProxies.length} frpc.`,
    );
    this.logger.log(`Valid host IDs: ${hosts.map((h) => h.id).join(', ')}`);

    const elements: CyElement[] = [];
    const createdNodeIds = new Set<string>();
    const hostsMap = new Map(hosts.map((h) => [h.id, h]));

    // Helper to add a node and track its ID
    const addNode = (node: CyElement) => {
      elements.push(node);
      createdNodeIds.add(node.data.id);
    };

    // Helper to add an edge only if both source and target nodes exist
    const addEdge = (edge: CyElement) => {
      if (
        edge.data.source &&
        edge.data.target &&
        createdNodeIds.has(edge.data.source) &&
        createdNodeIds.has(edge.data.target)
      ) {
        elements.push(edge);
      } else {
        this.logger.warn(
          `Skipping edge ${edge.data.id} because source '${edge.data.source}' or target '${edge.data.target}' does not exist.`,
        );
      }
    };

    // Step 1: Create top-level groups and physical hosts first
    const groups = [...new Set(hosts.map((h) => h.role))];
    groups.forEach((group) => {
      addNode({
        group: 'nodes',
        data: {
          id: `group-${group}`,
          label: group === 'local' ? 'Local Network' : 'Public Cloud',
          type: 'group',
        },
      });
    });

    hosts.forEach((host) => {
      addNode({
        group: 'nodes',
        data: {
          id: `host-${host.id}`,
          label: host.name,
          parent: `group-${host.role}`,
          type: 'host',
          hostData: host,
        },
      });
    });

    // Step 2: Create Compose Group nodes inside hosts
    const composeGroups = new Map<string, string>(); // composeGroupKey -> composeProjectName
    containers.forEach(c => {
      if (c.composeGroupKey && !composeGroups.has(c.composeGroupKey)) {
        composeGroups.set(c.composeGroupKey, c.composeProject || 'Compose Group');
      }
    });

    composeGroups.forEach((projectName, groupKey) => {
      const hostId = containers.find(c => c.composeGroupKey === groupKey)?.hostId;
      if (hostId) {
        addNode({
          group: 'nodes',
          data: {
            id: `compose-${groupKey}`,
            label: projectName,
            parent: `host-${hostId}`,
            type: 'compose-group',
          },
        });
      }
    });

    // Step 3: Create Container nodes, ensuring their parent (host or compose group) exists
    containers.forEach((container) => {
      const parentId = container.composeGroupKey
        ? `compose-${container.composeGroupKey}`
        : `host-${container.hostId}`;
      
      const hasParent = createdNodeIds.has(parentId);
      if (container.hostId && hasParent) {
        let type = 'container';
        if (container.imageName?.includes('nginx-proxy-manager')) type = 'npm';
        else if (container.imageName?.includes('frps')) type = 'frps';
        else if (container.imageName?.includes('frpc')) type = 'frpc';

        addNode({
          group: 'nodes',
          data: {
            id: `container-${container.id}`,
            label: container.name,
            parent: parentId,
            type: type,
            containerData: container,
          },
        });
      } else {
        this.logger.warn(`Skipping container ${container.id} (${container.name}) due to missing parent: ${parentId}`);
      }
    });
    
    // Step 4: Create Domain and logical Port nodes now that all containers exist
    const domains = [...new Set(routes.map((r) => r.domain))];
    domains.forEach((domain) => {
      const route = routes.find(r => r.domain === domain);
      const npmContainer = route ? this.findNpmContainer(route, containers) : undefined;
      const parentHostId = npmContainer ? `host-${npmContainer.hostId}` : undefined;
      addNode({
        group: 'nodes',
        data: { id: `domain-${domain}`, label: domain, type: 'domain', parent: parentHostId },
      });
    });

    const frpsConfigIdToContainer = new Map(
      frpsConfigs.map(fc => {
        const container = containers.find(c => c.containerId === fc.containerId);
        return [fc.id, container];
      }).filter((entry): entry is [string, Container] => entry[1] !== undefined)
    );

    frpcProxies.forEach(proxy => {
      const frpsContainer = frpsConfigIdToContainer.get(proxy.frpsConfigId);
      if (frpsContainer) {
        const portNodeId = `port-${proxy.remotePort}-on-${frpsContainer.id}`;
        addNode({
          group: 'nodes',
          data: { id: portNodeId, label: `Port ${proxy.remotePort}`, parent: `host-${frpsContainer.hostId}`, type: 'remote-port' },
        });
        addEdge({
          group: 'edges',
          data: { id: `edge-frps-${frpsContainer.id}-opens-${portNodeId}`, target: `container-${frpsContainer.id}`, source: portNodeId, label: 'opens', type: 'opens-edge' },
        });
      }
    });

    // Step 5: Create Edges with final, definitive logic
    for (const route of routes) {
      const npmContainer = this.findNpmContainer(route, containers);
      if (!npmContainer) continue;

      addEdge({
        group: 'edges',
        data: { id: `edge-npm-${npmContainer.id}-exposes-${route.domain}`, source: `container-${npmContainer.id}`, target: `domain-${route.domain}`, label: 'exposes', type: 'exposes-edge' },
      });

      const frpcProxy = frpcProxies.find(p => p.remotePort === route.forwardPort);
      if (frpcProxy) {
        // Handle FRP Route
        const frpsConfig = frpsConfigs.find(fc => fc.id === frpcProxy.frpsConfigId);
        const frpsContainer = frpsConfig ? containers.find(c => c.containerId === frpsConfig.containerId) : undefined;
        if (!frpsContainer) continue;

        const remotePortNodeId = `port-${frpcProxy.remotePort}-on-${frpsContainer.id}`;
        addEdge({
          group: 'edges',
          data: { id: `edge-domain-${route.domain}-to-port-${remotePortNodeId}`, source: `domain-${route.domain}`, target: remotePortNodeId, label: `proxy to:${frpcProxy.remotePort}` },
        });

        const frpcContainer = containers.find(c => c.containerId === frpcProxy.containerId);
        if (frpcContainer) {
          addEdge({
            group: 'edges',
            data: {
              id: `edge-frps-${frpsContainer.id}-to-frpc-${frpcContainer.id}-${frpcProxy.name}`,
              source: `container-${frpsContainer.id}`,
              target: `container-${frpcContainer.id}`,
              label: `tunnel-${frpcProxy.name}`,
              type: 'tunnel-edge',
            },
          });

          const containersOnFrpcHost = containers.filter(c => c.hostId === frpcContainer.hostId);
          const finalTarget = this.findContainerByIpAndPort(frpcProxy.localIp, frpcProxy.localPort, containersOnFrpcHost);
          if (finalTarget) {
            addEdge({
              group: 'edges',
              data: {
                id: `edge-frpc-${frpcContainer.id}-to-target-${finalTarget.id}`, 
                source: `container-${frpcContainer.id}`, 
                target: `container-${finalTarget.id}`, 
                label: `local:${frpcProxy.localPort}`, 
                type: 'frpc-edge' 
              },
            });
          } else {
            this.logger.warn(`Final target container for FRPC proxy ${frpcProxy.name} not found on the same host. Creating a logical node.`);
            const logicalNodeId = `logical-${frpcProxy.localIp}-${frpcProxy.localPort}-on-${frpcContainer.hostId}`;
            addNode({
                group: 'nodes',
                data: {
                    id: logicalNodeId,
                    label: `${frpcProxy.name}`,
                    parent: `host-${frpcContainer.hostId}`,
                    type: 'logical-container',
                },
            });
            addEdge({
                group: 'edges',
                data: {
                    id: `edge-frpc-${frpcContainer.id}-to-logical-${logicalNodeId}`,
                    source: `container-${frpcContainer.id}`,
                    target: logicalNodeId,
                    label: `local:${frpcProxy.localPort}`,
                    type: 'frpc-edge'
                },
            });
          }
        }
      } else {
        // Handle Direct Proxy Route
        const searchScope = containers.filter(c => c.hostId === npmContainer.hostId);
        const targetContainer = this.findContainerByIpAndPort(route.forwardHost, route.forwardPort, searchScope);
        if (!targetContainer) continue;
        
        const targetHost = hostsMap.get(targetContainer.hostId);
        if (targetHost?.role === 'local') continue;

        if (targetContainer.id !== npmContainer.id) {
          addEdge({
            group: 'edges',
            data: { id: `edge-domain-${route.domain}-to-target-${targetContainer.id}`, source: `domain-${route.domain}`, target: `container-${targetContainer.id}`, label: `proxy to:${route.forwardPort}` },
          });
        }
      }
    }

    this.logger.log(`Generated ${elements.length} valid elements for Cytoscape.`);
    return elements;
  }

  private isInternalIp(ip: string): boolean {
    if (!ip) return false;
    if (ip.startsWith('192.168.')) return true;
    if (ip.startsWith('10.')) return true;
    const octets = ip.split('.').map(Number);
    if (octets.length === 4 && octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
      return true;
    }
    return false;
  }

  private findNpmContainer(
    route: ReverseProxyRoute,
    containers: Container[],
  ): Container | undefined {
    return containers.find((c) => c.imageName?.includes('nginx-proxy-manager'));
  }

  private findContainerByIpAndPort(
    ip: string,
    port: number,
    containers: Container[],
  ): Container | undefined {
    const foundByManualPort = containers.find(c => {
      if (!c.manualPortMapping || typeof c.manualPortMapping !== 'object') return false;
      const mapping = c.manualPortMapping as any;
      return mapping.exposedPort === String(port);
    });
    if (foundByManualPort) return foundByManualPort;

    const foundByNet = containers.find((c) => {
      if (!c.networks || typeof c.networks !== 'object') return false;
      const networks = c.networks as any;
      for (const netName in networks) {
        if (networks[netName]?.IPAddress === ip) {
          if (!c.ports || typeof c.ports !== 'object') return false;
          const ports = c.ports as any[];
          return ports.some(p => p.PrivatePort === port || p.PublicPort === port);
        }
      }
      return false;
    });
    if (foundByNet) return foundByNet;

    const foundByName = containers.find((c) => c.name === ip || c.containerId === ip);
    if (foundByName) {
      if (!foundByName.ports || typeof foundByName.ports !== 'object') return false;
      const ports = foundByName.ports as any[];
      if (ports.some(p => p.PrivatePort === port || p.PublicPort === port)) {
        return foundByName;
      }
    }

    const foundByHostPort = containers.find(c => {
      if (!c.ports || !Array.isArray(c.ports)) return false;
      try {
        const portsInfo = c.ports as any[];
        return portsInfo.some(portInfo => 
          portInfo.bindings && Array.isArray(portInfo.bindings) &&
          portInfo.bindings.some(binding => binding.HostPort === String(port))
        );
      } catch (e) {
        this.logger.error(`Error parsing ports for container ${c.name}`, e);
        return false;
      }
    });
    if (foundByHostPort) return foundByHostPort;

    return undefined;
  }

  private findFrpcProxyForRoute(
    route: ReverseProxyRoute,
    frpcProxies: FrpcProxy[],
    frpsConfigId: string,
  ): FrpcProxy | undefined {
    const subdomain = route.domain.split('.')[0];
    return frpcProxies.find(
      (p) =>
        p.frpsConfigId === frpsConfigId &&
        (p.subdomain === subdomain || p.customDomains.includes(route.domain)),
    );
  }
}