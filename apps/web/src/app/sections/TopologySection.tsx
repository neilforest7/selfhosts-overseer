'use client';

import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Maximize, Minimize, Target } from 'lucide-react';

cytoscape.use(dagre);

const fetchTopologyData = async () => {
  const res = await fetch('/api/v1/topology/graph-data');
  if (!res.ok) {
    throw new Error('Network response was not ok');
  }
  return res.json();
};

const stylesheet = [
  // Group styles
  {
    selector: 'node[type="group"]',
    style: {
      'background-color': '#f1f1f1',
      'border-color': '#c8d1d8',
      'border-width': 2,
      'border-style': 'dashed',
      label: 'data(label)',
      'text-valign': 'top',
      'text-halign': 'left',
      'padding-top': '40px',
      'padding-bottom': '40px',
      'font-size': '64px',
      'font-weight': 'bold',
      color: '#f1f1f1',
      'text-outline-color': '#c8d1d8',
      'text-outline-width': 4,
    },
  },
  // Host node styles (as containers for other nodes)
  {
    selector: 'node[type="host"]',
    style: {
      shape: 'rectangle',
      'background-color': '#cdd1df',
      'border-color': '#aab4d4',
      'border-width': 2,
      'border-style': 'dotted',
      label: 'data(label)',
      'text-valign': 'center',
      'text-halign': 'center',
      'padding-top': '16px',
      'font-size': '240px',
      'font-weight': 'bold',
      color: '#ffffff',
    },
  },
  // DNS group styles
  {
    selector: 'node[id="group-dns"]',
    style: {
      'background-color': '#f1f1f1',
      'border-color': '#c8d1d8',
      'border-width': 2,
      'border-style': 'dashed',
      label: 'data(label)',
      'text-valign': 'top',
      'text-halign': 'left',
      'padding-top': '40px',
      'padding-bottom': '40px',
      'font-size': '64px',
      'font-weight': 'bold',
      color: '#f1f1f1',
      'text-outline-color': '#c8d1d8',
      'text-outline-width': 4,
    },
  },
  // Default node styles
  {
    selector: 'node[type!="group"][type!="host"][type!="compose-group"][type!="remote-port"][type!="logical-container"][type!="domain"]',
    style: {
      width: 180,
      height: 40,
      shape: 'round-rectangle',
      label: 'data(label)',
      'font-size': '18px',
      'text-wrap': 'wrap',
      'text-max-width': 120,
      'text-valign': 'center',
      'text-margin-y': 0,
      color: '#fff',
      'background-color': '#3498db',
      'border-color': '#2980b9',
      'text-outline-color': '#2980b9',
      'text-outline-width': 3,
      'text-outline-opacity': 1,
      'border-width': 2,
    },
  },
  // Compose group styles
  {
    selector: 'node[type="compose-group"]',
    style: {
      shape: 'rectangle',
      'background-color': '#c8d5e3',
      'border-color': '#6686a8',
      'border-width': 2,
      'border-style': 'dashed',
      label: 'data(label)',
      'text-valign': 'top',
      'text-halign': 'center',
      'padding-top': '28px',
      'font-size': '28px',
      'text-outline-color': '#6686a8',
      'text-outline-width': 4,
      color: '#fff',
    },
  },
  // Remote port styles
  {
    selector: 'node[type="remote-port"]',
    style: {
      shape: 'round-rectangle',
      width: 80,
      height: 30,
      'background-color': '#e67e22',
      'border-color': '#d35400',
      'border-width': 1,
      label: 'data(label)',
      'font-size': '9px',
      color: '#fff',
      'text-valign': 'center',
    },
  },
  // Logical container styles
  {
    selector: 'node[type="logical-container"]',
    style: {
      shape: 'ellipse',
      'background-color': '#ccdde8',
      'border-color': '#2980b9',
      'border-width': 2,
      'border-style': 'dashed',
      label: 'data(label)',
      'font-size': '16px',
      'text-wrap': 'wrap',
      'text-max-width': 80,
      'text-valign': 'center',
      'text-outline-color': '#2980b9',
      'text-outline-width': 2,
      color: '#fff',
      width: 80,
      height: 80,
    },
  },
  // Node styles
  {
    selector: 'node[type="domain"]',
    style: {
      shape: 'round-rectangle',
      label: 'data(label)',
      'font-size': '18px',
      'text-wrap': 'wrap',
      'text-max-width': 80,
      'text-valign': 'center',
      'text-margin-y': 0,
      'width': 190,
      'height': 40,
      'background-color': '#9b59b6',
      'border-color': '#8e44ad',
      color: '#fff', 
      'text-outline-color': '#8e44ad',
      'text-outline-width': 3,
      'text-outline-opacity': 1,
      'border-width': 2,
    },
  },
  // Container type styles
  // NPM
  {
    selector: 'node[type="npm"]',
    style: {
      shape: 'ellipse', 
      'width': '120px', // 大圆圈
      'height': '120px',
      'background-color': '#2ecc71', 
      'border-color': '#27ae60',
      'text-outline-color': '#27ae60',
      'font-size': '24px',
    },
  },
  // frps
  {
    selector: 'node[type="frps"]',
    style: { 
      shape: 'ellipse', 
      'width': '120px', // 大圆圈
      'height': '120px',
      'background-color': '#e67e22',
      'border-color': '#d35400', 
      'text-outline-color': '#d35400',
      'font-size': '36px',
    },
  },
  // frpc
  {
    selector: 'node[type="frpc"]',
    style: {
      shape: 'ellipse', 
      'width': '120px', // 大圆圈
      'height': '120px',
      'background-color': '#f1c40f',
      'border-color': '#f39c12',
      'text-outline-color': '#f39c12',
      'font-size': '36px',
    },
  },
  // DNS Provider styles
  {
    selector: 'node[type="dns-provider"]',
    style: {
      'background-color': '#FF6347', // 鲜橙色
      'shape': 'ellipse', // 圆圈形状
      'width': '120px', // 大圆圈
      'height': '120px',
      'border-width': 3,
      'border-color': '#FF4500',
      'color': '#FFFFFF',
      'text-outline-color': '#FF4500',
      'font-size': '36px',
      'text-valign': 'center',
      'text-halign': 'center',
      'font-weight': 'bold',
    },
  },
  // DNS Record styles
  {
    selector: 'node[type="dns-record"]',
    style: {
      shape: 'round-rectangle',
      label: 'data(label)',
      'font-size': '24px',
      'text-wrap': 'wrap',
      'text-max-width': 80,
      'text-valign': 'center',
      'text-margin-y': 0,
      'width': 210,
      'height': 40,
      'background-color': '#bd6ca4',
      'border-color': '#873b56',
      color: '#fff',
      'text-outline-color': '#873b56',
      'text-outline-width': 3,
      'text-outline-opacity': 1,
      'border-width': 2,
    },
  },
  // External IP styles
  {
    selector: 'node[type="external-ip"]',
    style: {
      'background-color': '#34495e',
      'shape': 'diamond',
      'border-width': 2,
      'border-color': '#2c3e50',
      'color': '#ffffff',
      'text-valign': 'center',
      'text-halign': 'center',
      'font-size': '12px',
    },
  },
  // Edge styles
  {
    selector: 'edge',
    style: {
      width: 6,
      'line-color': '#a0b3c4',
      'target-arrow-color': '#a0b3c4',
      'target-arrow-shape': 'triangle',
      'curve-style': 'round-taxi',
      'taxi-direction':'vertical',
      'taxi-radius':'50',
      'taxi-turn':'40%',
      'edge-distances':'node-position',
      label: 'data(label)',
      'font-size': '8px',
      'edge-text-rotation': 'autorotate',
    },
  },
  {
    selector: 'edge[type="exposes-edge"]',
    style: {
      width: 6,
      'line-color': '#a0b3c4',
      'target-arrow-color': '#a0b3c4',
      'target-arrow-shape': 'triangle',
      'curve-style': 'round-taxi',
      'taxi-direction': 'vertical',
      'taxi-radius': '50',
      'taxi-turn': '50%',
      'edge-distances': 'node-position',
      // label: '',
      'font-size': '8px',
      'edge-text-rotation': 'autorotate',
    },
  },
  {
    selector: 'edge[type="opens-edge"]',
    style: {
      width: 6,
      'line-color': '#e74c3c',
      'target-arrow-color': '#e74c3c',
      'target-arrow-shape': 'triangle',
      'curve-style': 'round-taxi',
      'taxi-direction': 'vertical',
      'taxi-radius': '80',
      'taxi-turn': '50%',
      'edge-distances': 'node-position',
      // label: '',
      'font-size': '8px',
      'edge-text-rotation': 'autorotate',
    },
  }, 
  {
    selector: 'edge[type="frpc-edge"]',
    style: {
      width: 6,
      'line-color': '#e5a717',
      'target-arrow-color': '#e5a717',
      'target-arrow-shape': 'triangle',
      'curve-style': 'round-taxi',
      'taxi-direction': 'vertical',
      'taxi-radius': '80',
      'taxi-turn': '160px',
      'edge-distances': 'node-position',
      // label: 'data(label)',
      'font-size': '8px',
      'edge-text-rotation': 'autorotate',
    },
  },
  {
    selector: 'edge[type="tunnel-edge"]',
    style: {
      'curve-style': 'round-taxi',
      'control-point-step-size': '14px',
      'line-color': '#e5a717',
      'target-arrow-color': '#e5a717',
      // label: 'data(label)',
      'font-size': '12px',
      'taxi-direction': 'vertical',
      'taxi-radius': '80',
      'taxi-turn': '160px',

    },
  },
  // DNS-related edge styles
  {
    selector: 'edge[type="dns-resolution-edge"]',
    style: {
      'curve-style': 'straight', // Render as straight lines
      'line-style': 'solid',
      'target-arrow-shape': 'triangle',
      'line-color': '#9370DB',
      'target-arrow-color': '#9370DB',
      'width': 6,
      // label: 'data(label)',
      'font-size': '8px',
    },
  },
  {
    selector: 'edge[type="dns-record-to-npm-edge"]',
    style: {
      'curve-style': 'round-taxi',
      'taxi-direction': 'vertical',
      'taxi-radius': '80',
      'taxi-turn': '200px',
      // Render as straight lines
      'line-style': 'solid',
      'target-arrow-shape': 'triangle',
      'line-color': '#27ae60',
      'target-arrow-color': '#27ae60',
      'width': 4,
      // label: 'data(label)',
      'font-size': '8px',
    },
  },
  {
    selector: 'edge[type="dns-provider-to-record-edge"]',
    style: {
      'curve-style': 'bezier',
      'line-style': 'solid',
      'target-arrow-shape': 'triangle',
      'line-color': '#FF6347',
      'target-arrow-color': '#FF6347',
      'width': 4,
      // label: 'data(label)',
      'taxi-direction': 'verticle',
      'taxi-radius': '90',
      'taxi-turn': '120px',
      'font-size': '8px',
    },
  },
  {
    selector: 'edge[type="dns-management-edge"]',
    style: {
      'curve-style': 'round-taxi',
      'taxi-direction': 'vertical',
      'taxi-radius': '80',
      'taxi-turn': '160px',
      'line-style': 'solid',
      'target-arrow-shape': 'triangle',
      'line-color': '#FF6347',
      'target-arrow-color': '#FF6347',
      'width': 6,
      // label: 'data(label)',
      'font-size': '8px',
    },
  },
];

const layout = {
  name: 'dagre',
  rankDir: 'TB',
  spacingFactor: 1.2,
  nodeSep: 60,
  rankSep: 120,
};

// Function to apply minimal auto-layout within individual host containers
// Arranges target nodes horizontally and positions domain nodes above them
const applyHostContainerLayouts = (cy: cytoscape.Core) => {
  // Get all host nodes
  const hostNodes = cy.nodes('[type="host"]');

  hostNodes.forEach((hostNode) => {
    // Get target node types that need horizontal alignment
    const composeGroups = hostNode.children('[type="compose-group"]');
    const standaloneContainers = hostNode.children('[type="container"]');
    const logicalContainers = hostNode.children('[type="logical-container"]');
    const remotePortNodes = hostNode.children('[type="remote-port"]');

    // Combine all target nodes for horizontal arrangement
    const targetNodes = composeGroups.children().union(standaloneContainers).union(logicalContainers).union(remotePortNodes);

    if (targetNodes.length === 0) return;

    // Get the host's bounding box for X-axis calculations
    const hostBB = hostNode.boundingBox();
    const padding = 60;

    // Calculate available width based on actual content widths
    // Width A: Sum of widths of all target nodes (compose-group, container, logical-container, remote-port)
    const allTargetNodes = composeGroups.union(standaloneContainers).union(logicalContainers).union(remotePortNodes);
    const widthA = allTargetNodes.reduce((sum, node) => {
      return sum + node.boundingBox().w + padding;
    }, 0);

    // Width B: Sum of widths of all domain nodes that are children of the host
    const hostDomainNodes = hostNode.children('[type="domain"]');
    const widthB = hostDomainNodes.reduce((sum, node) => {
      return sum + node.boundingBox().w + padding;
    }, 0);

    // Use the maximum of these two widths as the basis for availableWidth
    const contentBasedWidth = Math.max(widthA, widthB);
    hostNode.style({ 'width': contentBasedWidth, 'height': hostBB.h });

    const availableWidth = contentBasedWidth > 0 ? contentBasedWidth : hostBB.w - (padding * 2);
    // Calculate horizontal spacing for even distribution
    const nodeSpacing = targetNodes.length > 1 ? availableWidth / (targetNodes.length + 1) : availableWidth / 2;

    // Arrange target nodes horizontally with consistent Y-alignment
    const targetNodePositions: { [key: string]: { x: number; y: number } } = {};

    // Calculate a consistent Y position for all target nodes (use the average Y position)
    let totalY = 0;
    let validYCount = 0;
    targetNodes.forEach((node) => {
      const pos = node.position();
      if (pos && typeof pos.y === 'number' && !isNaN(pos.y)) {
        totalY += pos.y;
        validYCount++;
      }
    });
    const consistentY = validYCount > 0 ? totalY / validYCount : hostBB.y1 + hostBB.h * 0.7;

    targetNodes.forEach((node, index) => {
      const newX = hostBB.x1 + padding + nodeSpacing * (index + 1);

      // Store the new position for later use in domain positioning
      targetNodePositions[node.id()] = { x: newX, y: consistentY };

      // Set both X position and consistent Y position for horizontal alignment
      node.position({
        x: newX,
        y: consistentY
      });
    });

    // Position domain nodes: connected ones above targets, unconnected ones grouped together
    const connectedDomainNodes: any[] = [];
    const unconnectedDomainNodes: any[] = [];

    hostDomainNodes.forEach((domainNode) => {
      // Find edges from this domain node to target nodes within the same host
      const connectedEdges = domainNode.connectedEdges();
      const connectedTargetNodes = connectedEdges.targets().intersection(targetNodes);

      if (connectedTargetNodes.length > 0) {
        connectedDomainNodes.push({ node: domainNode, targets: connectedTargetNodes });
      } else {
        unconnectedDomainNodes.push(domainNode);
      }
    });

    // Position connected domain nodes above their corresponding target nodes
    connectedDomainNodes.forEach(({ node: domainNode, targets: connectedTargetNodes }) => {
      // Use the first connected target node's X position for alignment
      const firstTargetNode = connectedTargetNodes[0];
      const targetPosition = targetNodePositions[firstTargetNode.id()];

      if (targetPosition) {
        const currentDomainPosition = domainNode.position();

        // Align domain node's X coordinate with the target node's X coordinate
        // Keep the domain node's Y coordinate unchanged
        domainNode.position({
          x: targetPosition.x,
          y: currentDomainPosition.y
        });
      }
    });

    // Position unconnected domain nodes grouped together horizontally
    if (unconnectedDomainNodes.length > 0) {
      // Calculate spacing for unconnected domain nodes
      const domainSpacing = unconnectedDomainNodes.length > 1 ?
        availableWidth / (unconnectedDomainNodes.length + 1) :
        availableWidth / 2;

      unconnectedDomainNodes.forEach((domainNode, index) => {
        const currentDomainPosition = domainNode.position();
        const newX = hostBB.x1 + padding + domainSpacing * (index + 1);

        domainNode.position({
          x: newX,
          y: currentDomainPosition.y - hostBB.h * 0.1
        });
      });
    }
  });

  // Apply specific container type positioning rules after shrinking
  applySpecificContainerPositioning(cy);

  // Apply DNS group layout (separate from host containers)
  applyDnsGroupLayout(cy);
  
  // Shrink host containers to fit tightly around their child nodes
  shrinkHostContainers(cy);
  // Shrink group containers to fit around repositioned host containers
  shrinkGroupContainers(cy);

  // Apply viewport management to center and fit all nodes properly
  fitTopLevelGroups(cy);
};

// Function to apply specific container type positioning rules after shrinking
const applySpecificContainerPositioning = (cy: cytoscape.Core) => {
  const hostNodes = cy.nodes('[type="host"]');
  const containerPadding = 20; // Padding from host edges

  hostNodes.forEach((hostNode) => {
    // Add comprehensive null checks before calling boundingBox()
    if (!hostNode || typeof hostNode.boundingBox !== 'function' || !hostNode.children) return;

    let hostBB;
    try {
      hostBB = hostNode.boundingBox();
    } catch (error) {
      console.warn('Error getting bounding box for host node:', error);
      return;
    }

    // Validate the bounding box object
    if (!hostBB ||
        typeof hostBB.x1 !== 'number' ||
        typeof hostBB.x2 !== 'number' ||
        typeof hostBB.y1 !== 'number' ||
        typeof hostBB.y2 !== 'number' ||
        typeof hostBB.w !== 'number' ||
        typeof hostBB.h !== 'number' ||
        isNaN(hostBB.x1) || isNaN(hostBB.x2) || isNaN(hostBB.y1) || isNaN(hostBB.y2) ||
        isNaN(hostBB.w) || isNaN(hostBB.h)) {
      console.warn('Invalid bounding box for host node:', hostBB);
      return;
    }

    const children = hostNode.children();

    // Get specific container types
    const allComposeGroups = children.filter('[type="compose-group"]');
    const standaloneNpmContainers = children.filter('[type="npm"]');
    const frpcContainers = children.filter('[type="frpc"]');
    const frpsContainers = children.filter('[type="frps"]');

    // 1. Identify NPM-containing compose groups and standalone NPM containers
    const npmContainingComposeGroups: any[] = [];
    const finalStandaloneNpmContainers: any[] = [];

    // Check each compose group to see if it contains NPM containers
    allComposeGroups.forEach((composeGroup) => {
      if (!composeGroup || !composeGroup.children) return;

      const npmInGroup = composeGroup.children('[type="npm"]');
      if (npmInGroup.length > 0) {
        npmContainingComposeGroups.push(composeGroup);
        console.log(`Found compose group ${composeGroup.id()} containing ${npmInGroup.length} NPM container(s)`);
      }
    });

    // Check for standalone NPM containers (not part of any compose group)
    standaloneNpmContainers.forEach((npmContainer) => {
      if (!npmContainer || !npmContainer.parent) {
        finalStandaloneNpmContainers.push(npmContainer);
        return;
      }

      // Check if this NPM container's parent is a compose group
      const parent = npmContainer.parent();
      if (!parent || parent.data('type') !== 'compose-group') {
        finalStandaloneNpmContainers.push(npmContainer);
        console.log(`Found standalone NPM container ${npmContainer.id()}`);
      }
    });

    console.log(`NPM positioning analysis:`, {
      npmContainingComposeGroups: npmContainingComposeGroups.length,
      standaloneNpmContainers: finalStandaloneNpmContainers.length,
      frpcContainers: frpcContainers.length
    });

    // 1. Position NPM-containing compose groups, standalone NPM containers, and FRPC containers at top center
    const topUnits = [...npmContainingComposeGroups, ...finalStandaloneNpmContainers, ...frpcContainers];

    if (topUnits.length > 0) {
      const topY = hostBB.y1 - containerPadding - 250;
      const centerX = hostBB.x1 + (hostBB.w / 2);

      console.log(`Positioning ${topUnits.length} units at top center of host`);

      if (topUnits.length === 1) {
        // Single unit - center it
        const unit = topUnits[0];
        console.log(`Centering single unit ${unit.id()} at (${centerX}, ${topY})`);

        unit.position({
          x: centerX,
          y: topY
        });
      } else {
        // Multiple units - distribute them horizontally around center
        const spacing = Math.min(120, hostBB.w / (topUnits.length + 1));
        topUnits.forEach((unit, index) => {
          const offsetX = (index - (topUnits.length - 1) / 2) * spacing;
          const finalX = centerX + offsetX;

          console.log(`Positioning unit ${unit.id()} at (${finalX}, ${topY})`);

          unit.position({
            x: finalX,
            y: topY
          });
        });
      }
    }

    // 2. Position FRPS containers at bottom center
    if (frpsContainers.length > 0) {
      const bottomY = hostBB.y2 - containerPadding +50;
      const centerX = hostBB.x1 + (hostBB.w / 2);

      if (frpsContainers.length === 1) {
        // Single container - center it
        frpsContainers[0].position({
          x: centerX,
          y: bottomY
        });
      } else {
        // Multiple containers - distribute them horizontally around center
        const spacing = Math.min(100, hostBB.w / (frpsContainers.length + 1));
        frpsContainers.forEach((container, index) => {
          const offsetX = (index - (frpsContainers.length - 1) / 2) * spacing;
          container.position({
            x: centerX + offsetX,
            y: bottomY
          });
        });
      }
    }

    // Note: DNS provider container layout is now handled separately in applyDnsGroupLayout()
  });
};

// Function to apply DNS group layout - organize DNS records into two rows
const applyDnsGroupLayout = (cy: cytoscape.Core) => {
  // Find the DNS group container
  const dnsGroupNode = cy.nodes('[id="group-dns"]');

  if (dnsGroupNode.length === 0) {
    console.log('No DNS group found, skipping DNS layout');
    return;
  }

  console.log('Processing DNS group layout');

  // Get DNS providers and DNS records within the DNS group
  const dnsProviders = dnsGroupNode.children('[type="dns-provider"]');
  const dnsRecords = dnsGroupNode.children('[type="dns-record"]');

  console.log('DNS group contents:', {
    dnsProviders: dnsProviders.length,
    dnsRecords: dnsRecords.length
  });

  if (dnsRecords.length === 0) {
    console.log('No DNS records found in DNS group');
    return;
  }

  // Separate DNS records by connectivity
  const connectedRecords: any[] = [];
  const unconnectedRecords: any[] = [];

  dnsRecords.forEach((record) => {
    if (!record || typeof record.outgoers !== 'function') {
      console.warn('Invalid DNS record node:', record);
      return;
    }

    try {
      // Check for outgoing edges (downstream connections)
      const outgoingEdges = record.outgoers('edge');
      console.log(`DNS record ${record.id()} has ${outgoingEdges.length} outgoing edges`);

      if (outgoingEdges.length > 0) {
        connectedRecords.push(record);
      } else {
        unconnectedRecords.push(record);
      }

      
    } catch (error) {
      console.warn('Error checking outgoing edges for DNS record:', error);
      unconnectedRecords.push(record); // Default to unconnected if error
    }
  });

  console.log('DNS record classification:', {
    connected: connectedRecords.length,
    unconnected: unconnectedRecords.length
  });

  // Get the DNS group bounding box for positioning
  let dnsGroupBB;
  try {
    dnsGroupBB = dnsGroupNode.boundingBox();
  } catch (error) {
    console.warn('Error getting DNS group bounding box:', error);
    return;
  }

  if (!dnsGroupBB) {
    console.warn('Invalid DNS group bounding box');
    return;
  }

  const recordSpacing = 240; // Horizontal spacing between records
  const rowSpacing = 160; // Vertical spacing between rows
  const containerPadding = 20; // Padding from group edges

  // Calculate positioning within the DNS group
  const upperRowY = dnsGroupBB.y1 + containerPadding;
  const lowerRowY = dnsGroupBB.y1 + containerPadding + rowSpacing;
  const startX = dnsGroupBB.x1 + containerPadding;

  // Position unconnected records in upper row
  if (unconnectedRecords.length > 0) {
    console.log('Positioning unconnected DNS records in upper row');
    unconnectedRecords.forEach((record, index) => {
      try {
        const newX = startX + (index * recordSpacing);
        console.log(`Positioning unconnected DNS record ${record.id()} at (${newX}, ${upperRowY})`);

        record.position({
          x: newX,
          y: upperRowY
        });
      } catch (error) {
        console.warn('Error positioning unconnected DNS record:', error);
      }
    });
  }

  // Position connected records in lower row
  if (connectedRecords.length > 0) {
    console.log('Positioning connected DNS records in lower row');
    connectedRecords.forEach((record, index) => {
      try {
        const newX = startX + (index * recordSpacing);
        console.log(`Positioning connected DNS record ${record.id()} at (${newX}, ${lowerRowY})`);

        record.position({
          x: newX,
          y: lowerRowY
        });
      } catch (error) {
        console.warn('Error positioning connected DNS record:', error);
      }
    });

  }

  // Position DNS providers based on connected records
  if (connectedRecords.length > 0) {
    let centerX: number = 0;

    // Calculate center X position for DNS provider positioning
    try {
      // calculate middle x for provider positioning
      const totalX = connectedRecords.reduce((acc, record) => acc + record.position().x, 0);
      centerX = totalX / connectedRecords.length;
    } catch (error) {
      console.warn('Error calculating DNS provider center position:', error);
      centerX = dnsGroupBB.x1 + (dnsGroupBB.w / 2); // Fallback to group center
    }

    dnsProviders.forEach((prov) => {
      try {
        prov.position({
          x: centerX,
          y: prov.position().y - rowSpacing * 6
        });
      } catch (error) {
        console.warn('Error positioning DNS provider:', error);
      }
    });
  }

  console.log('DNS group layout completed');
};

// Function to resize host containers to fit tightly around their child nodes
const shrinkHostContainers = (cy: cytoscape.Core) => {
  const hostNodes = cy.nodes('[type="host"]').union(cy.nodes('[type="dns-group"]'));
  const minPadding = 30; // Minimal padding around child nodes

  hostNodes.forEach((hostNode) => {
    // Add null check for hostNode
    if (!hostNode || !hostNode.children) return;

    const children = hostNode.children();

    if (children.length === 0) return;

    // Calculate the bounding box of all child nodes
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let validChildrenCount = 0;

    children.forEach((child) => {
      // Add comprehensive null checks before calling boundingBox()
      if (!child || typeof child.boundingBox !== 'function') {
        console.warn('Invalid child node detected, skipping:', child);
        return;
      }

      try {
        const childBB = child.boundingBox();

        // Validate the bounding box object
        if (!childBB ||
            typeof childBB.x1 !== 'number' ||
            typeof childBB.x2 !== 'number' ||
            typeof childBB.y1 !== 'number' ||
            typeof childBB.y2 !== 'number' ||
            isNaN(childBB.x1) || isNaN(childBB.x2) || isNaN(childBB.y1) || isNaN(childBB.y2)) {
          console.warn('Invalid bounding box for child node:', childBB);
          return;
        }

        minX = Math.min(minX, childBB.x1);
        maxX = Math.max(maxX, childBB.x2);
        minY = Math.min(minY, childBB.y1);
        maxY = Math.max(maxY, childBB.y2);
        validChildrenCount++;
      } catch (error) {
        console.warn('Error getting bounding box for child node:', error);
      }
    });

    // Only proceed if we have valid children with bounding boxes
    if (validChildrenCount === 0 || minX === Infinity || maxX === -Infinity || minY === Infinity || maxY === -Infinity) {
      console.warn('No valid child nodes found for host container shrinking');
      return;
    }

    // Calculate the new host dimensions with minimal padding
    const newWidth = (maxX - minX) + (minPadding * 2);
    const newHeight = (maxY - minY) + (minPadding * 2);

    // Calculate the new host center position
    const newCenterX = (minX + maxX) / 2;
    const newCenterY = (minY + maxY) / 2;

    // Validate the calculated values before applying
    if (isNaN(newWidth) || isNaN(newHeight) || isNaN(newCenterX) || isNaN(newCenterY)) {
      console.warn('Invalid calculated dimensions for host container:', { newWidth, newHeight, newCenterX, newCenterY });
      return;
    }

    try {
      // Update host node size and position
      hostNode.style({
        'width': newWidth,
        'height': newHeight
      });

      hostNode.position({
        x: newCenterX,
        y: newCenterY
      });
    } catch (error) {
      console.warn('Error updating host node style or position:', error);
    }
  });
};

// Function to organize child nodes within group containers
const shrinkGroupContainers = (cy: cytoscape.Core) => {
  const groupNodes = cy.nodes('[type="group"]');
  const childSpacing = 100; // Minimal spacing between child nodes (shoulder-to-shoulder)

  console.log(`Processing ${groupNodes.length} group containers for child node organization`);

  groupNodes.forEach((groupNode) => {
    // Add comprehensive null checks
    if (!groupNode || !groupNode.children) {
      console.warn('Invalid group node detected, skipping:', groupNode);
      return;
    }

    const hostChildren = groupNode.children('[type="host"]');

    if (hostChildren.length === 0) {
      console.log(`Group ${groupNode.id()} has no host children, skipping`);
      return;
    }

    console.log(`Organizing ${hostChildren.length} child nodes in group ${groupNode.id()}`);

    // Step 1: Calculate average Y position for horizontal alignment
    let totalY = 0;
    let validChildrenCount = 0;

    hostChildren.forEach((child) => {
      if (!child || typeof child.position !== 'function') {
        console.warn('Invalid child node detected, skipping:', child);
        return;
      }

      try {
        const pos = child.position();
        if (pos && typeof pos.y === 'number' && !isNaN(pos.y)) {
          totalY += pos.y;
          validChildrenCount++;
        }
      } catch (error) {
        console.warn('Error getting child position:', error);
      }
    });

    if (validChildrenCount === 0) {
      console.warn(`No valid child positions found in group ${groupNode.id()}`);
      return;
    }

    const averageY = totalY / validChildrenCount;
    console.log(`Calculated average Y position: ${averageY} for group ${groupNode.id()}`);

    // Step 2: Calculate total width needed for all children with spacing
    let totalWidth = 0;
    const childWidths: number[] = [];

    hostChildren.forEach((child) => {
      if (!child || typeof child.boundingBox !== 'function') return;

      try {
        const childBB = child.boundingBox();
        if (childBB && typeof childBB.w === 'number' && !isNaN(childBB.w)) {
          childWidths.push(childBB.w);
          totalWidth += childBB.w;
        }
      } catch (error) {
        console.warn('Error getting child bounding box:', error);
        childWidths.push(200); // Default width fallback
        totalWidth += 200;
      }
    });

    // Add spacing between children (n-1 gaps for n children)
    const totalSpacing = (hostChildren.length - 1) * childSpacing;
    const totalArrangementWidth = totalWidth + totalSpacing;

    console.log(`Total arrangement width: ${totalArrangementWidth} (${totalWidth} content + ${totalSpacing} spacing)`);

    // Step 3: Calculate starting X position to center around X=0
    const startX = -(totalArrangementWidth / 2);
    console.log(`Starting X position: ${startX} to center around X=0`);

    // Step 4: Position each child node
    let currentX = startX;

    hostChildren.forEach((child, index) => {
      if (!child || typeof child.position !== 'function') return;

      try {
        const childWidth = childWidths[index] || 200;
        const childCenterX = currentX + (childWidth / 2);

        console.log(`Positioning child ${index} (${child.id()}) at X=${childCenterX}, Y=${averageY}`);

        child.position({
          x: childCenterX,
          y: averageY
        });

        // Move to next position
        currentX += childWidth + childSpacing;
      } catch (error) {
        console.warn('Error positioning child node:', error);
      }
    });

    console.log(`Completed organization of group ${groupNode.id()}`);
  });

  console.log('Group container child organization completed');
};

// Function to apply viewport management for optimal topology viewing
const applyViewportCentering = (cy: cytoscape.Core) => {
  console.log('Applying viewport centering for optimal topology viewing');

  try {
    // Get all nodes to ensure we're working with the complete topology
    const allNodes = cy.nodes();
    const mainGroupIds = ['group-dns', 'group-local-network', 'group-public-cloud'];
    const mainGroups = cy.nodes().filter(node => mainGroupIds.includes(node.id()));

    console.log(`Total nodes: ${allNodes.length}, Main groups found: ${mainGroups.length}`);

    if (allNodes.length === 0) {
      console.warn('No nodes found for viewport centering');
      return;
    }

    // Method 1: Use cy.fit() with padding to ensure all nodes are visible with good spacing
    const padding = 80; // Padding around the edges for better visual balance

    console.log(`Applying cy.fit() with ${padding}px padding`);
    cy.fit(allNodes, padding);

    // Small delay to ensure fit operation is complete, then center the viewport
    setTimeout(() => {
      try {
        console.log('Applying cy.center() for optimal centering');
        cy.center(allNodes);

        // Log the final viewport state for debugging
        const extent = cy.extent();
        const zoom = cy.zoom();
        const pan = cy.pan();

        console.log('Viewport centering completed:', {
          extent: {
            x1: extent.x1,
            y1: extent.y1,
            x2: extent.x2,
            y2: extent.y2,
            width: extent.x2 - extent.x1,
            height: extent.y2 - extent.y1
          },
          zoom: zoom,
          pan: { x: pan.x, y: pan.y }
        });

        // Optional: Fine-tune zoom level if needed
        const currentZoom = cy.zoom();
        if (currentZoom > 2) {
          console.log('Zoom level too high, adjusting to 1.5');
          cy.zoom(1.5);
          cy.center(allNodes);
        } else if (currentZoom < 0.3) {
          console.log('Zoom level too low, adjusting to 0.5');
          cy.zoom(0.5);
          cy.center(allNodes);
        }
        cy.fit();
      } catch (error) {
        console.warn('Error during center operation:', error);
      }
    }, 100);

  } catch (error) {
    console.warn('Error during viewport centering:', error);

    // Fallback: Simple fit operation
    try {
      console.log('Applying fallback cy.fit()');
      cy.fit();
    } catch (fallbackError) {
      console.warn('Fallback fit operation also failed:', fallbackError);
    }
  }
};

// 使用顶层方块进行视口适配（按钮与初始化共用）
const fitTopLevelGroups = (cy: cytoscape.Core, padding: number = 80) => {
  try {
    const groupNodes = cy.nodes('[type="group"]');
    const targets = groupNodes.length > 0 ? groupNodes : cy.nodes().orphans();
    if (targets.length === 0) return;
    cy.fit(targets, padding);
  } catch (error) {
    console.warn('Error fitting top-level groups:', error);
  }
};

export default function TopologySection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['topologyData'],
    queryFn: fetchTopologyData,
  });
  const [isMaximized, setIsMaximized] = useState(false);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const handleFitTopLevelGroups = () => {
    const cy = cyRef.current;
    if (!cy) return;
    fitTopLevelGroups(cy, 80);
  };

  const containerStyle: React.CSSProperties = isMaximized
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 9999,
        backgroundColor: 'white',
      }
    : {
        height: 'calc(100vh - 150px)',
        width: '100%',
        border: '1px solid #eee',
        position: 'relative',
      };

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>网络拓扑</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={containerStyle}>
            <Button
              variant="outline"
              size="icon"
              className="absolute top-2 right-2 z-10"
              onClick={() => setIsMaximized(!isMaximized)}
            >
              {isMaximized ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="absolute top-2 right-14 z-10"
              onClick={handleFitTopLevelGroups}
              title="适配顶层方块到视口"
            >
              <Target className="h-4 w-4" />
            </Button>
            {isLoading && <div>Loading topology...</div>}
            {error && <div>Error fetching topology data.</div>}
            {data && (
              <CytoscapeComponent
                elements={data || []}
                stylesheet={stylesheet}
                layout={layout}
                style={{ width: '100%', height: '100%' }}
                cy={(cy) => {
                  cyRef.current = cy;
                  cy.maxZoom(3);
                  cy.minZoom(0.05);
                  // Apply auto-layout within host containers after main layout
                  cy.ready(() => {
                    // Add a small delay to ensure the main layout is complete
                    setTimeout(() => {
                      applyHostContainerLayouts(cy);
                    }, 800);
                  });
                }}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}