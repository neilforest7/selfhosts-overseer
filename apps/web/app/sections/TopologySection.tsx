'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Maximize, Minimize } from 'lucide-react';

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
      'background-color': '#f0f4f8',
      'border-color': '#a0b3c4',
      'border-width': 2,
      'border-style': 'dashed',
      label: 'data(label)',
      'text-valign': 'top',
      'text-halign': 'center',
      'padding-top': '10px',
      'font-size': '26px',
      'font-weight': 'bold',
      color: '#717889',
    },
  },
  // Host node styles (as containers for other nodes)
  {
    selector: 'node[type="host"]',
    style: {
      shape: 'rectangle',
      'background-color': '#e3e6f0',
      'border-color': '#ccccd8',
      'border-width': 6,
      'border-style': 'dotted',
      label: 'data(label)',
      'text-valign': 'top',
      'text-halign': 'center',
      'padding-top': '16px',
      'font-size': '24px',
      'font-weight': 'bold',
      color: '#65657d',
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
      'padding-top': '5px',
      'font-size': '10px',
      color: '#6686a8',
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
      'text-outline-opacity': 1,
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
  {
    selector: 'node[type!="group"][type!="host"][type!="compose-group"][type!="remote-port"][type!="logical-container"][type!="domain"]',
    style: {
      width: 80,
      height: 80,
      label: 'data(label)',
      'font-size': '18px',
      'text-wrap': 'wrap',
      'text-max-width': 80,
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
  {
    selector: 'node[type="npm"]',
    style: { 
      'background-color': '#2ecc71', 
      'border-color': '#27ae60',
      'text-outline-color': '#27ae60',
      'font-size': '24px',
    },
  },
  {
    selector: 'node[type="frps"]',
    style: { 
      'background-color': '#e67e22',
      'border-color': '#d35400', 
      'text-outline-color': '#d35400',
      'font-size': '24px',
    },
  },
  {
    selector: 'node[type="frpc"]',
    style: {
      'background-color': '#f1c40f',
      'border-color': '#f39c12',
      'text-outline-color': '#f39c12',
      'font-size': '24px',
    },
  },
  // DNS Provider styles
  {
    selector: 'node[type="dns-provider"]',
    style: {
      'background-color': '#FF6347', // 鲜橙色
      'shape': 'ellipse', // 圆圈形状
      'width': '80px', // 大圆圈
      'height': '80px',
      'border-width': 3,
      'border-color': '#FF4500',
      'color': '#FFFFFF',
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
      'font-size': '18px',
      'text-wrap': 'wrap',
      'text-max-width': 80,
      'text-valign': 'center',
      'text-margin-y': 0,
      'width': 210,
      'height': 40,
      'background-color': '#c89dd8',
      'border-color': '#a975c0',
      color: '#fff',
      'text-outline-color': '#a975c0',
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
      width: 2,
      'line-color': '#a0b3c4',
      'target-arrow-color': '#a0b3c4',
      'target-arrow-shape': 'triangle',
      'curve-style': 'round-taxi',
      'taxi-direction':'vertical',
      'taxi-radius':'30',
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
      width: 2,
      'line-color': '#a0b3c4',
      'target-arrow-color': '#a0b3c4',
      'target-arrow-shape': 'triangle',
      'curve-style': 'round-taxi',
      'taxi-direction': 'vertical',
      'taxi-radius': '30',
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
      width: 2,
      'line-color': '#e74c3c',
      'target-arrow-color': '#a0b3c4',
      'target-arrow-shape': 'triangle',
      'curve-style': 'round-taxi',
      'taxi-direction': 'vertical',
      'taxi-radius': '30',
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
      width: 2,
      'line-color': '#e7b93c',
      'target-arrow-color': '#a0b3c4',
      'target-arrow-shape': 'triangle',
      'curve-style': 'round-taxi',
      'taxi-direction': 'vertical',
      'taxi-radius': '30',
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
      'curve-style': 'bezier',
      'control-point-step-size': '14px',
      'line-color': '#c2cfdb',
      'target-arrow-color': '#a0b3c4',
      // label: 'data(label)',
      'font-size': '12px',
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
      'width': 2,
      // label: 'data(label)',
      'font-size': '8px',
    },
  },
  {
    selector: 'edge[type="dns-record-to-npm-edge"]',
    style: {
      'curve-style': 'straight', // Render as straight lines
      'line-style': 'solid',
      'target-arrow-shape': 'triangle',
      'line-color': '#27ae60',
      'target-arrow-color': '#27ae60',
      'width': 2,
      // label: 'data(label)',
      'font-size': '8px',
    },
  },
  {
    selector: 'edge[type="dns-provider-to-record-edge"]',
    style: {
      'curve-style': 'straight',
      'line-style': 'solid',
      'target-arrow-shape': 'triangle',
      'line-color': '#FF6347',
      'target-arrow-color': '#FF6347',
      'width': 2,
      // label: 'data(label)',
      'font-size': '8px',
    },
  },
  {
    selector: 'edge[type="dns-management-edge"]',
    style: {
      'curve-style': 'straight',
      'line-style': 'solid',
      'target-arrow-shape': 'triangle',
      'line-color': '#FF6347',
      'target-arrow-color': '#FF6347',
      'width': 2,
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
// Only adjusts X-axis positioning while preserving Y-axis positions
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
    const padding = 20;
    const availableWidth = hostBB.w - (padding * 2);

    // Calculate horizontal spacing for even distribution
    const nodeSpacing = targetNodes.length > 1 ? availableWidth / (targetNodes.length + 1) : availableWidth / 2;

    if (hostNode.children('node[type="npm"]').length === 0) {
      // Arrange target nodes horizontally while preserving Y positions
      targetNodes.forEach((node, index) => {
        const currentPosition = node.position();
        const newX = hostBB.x1 + padding + nodeSpacing * (index + 1);

        // Only modify X position, keep Y position unchanged
        node.position({
          x: newX,
          y: currentPosition.y
        });
      });
    } else {
      // targetNodes.forEach((node, index) => {
      //   const currentPosition = node.position();
      //   const newX = hostBB.x1 + padding + nodeSpacing * (index + 1);

      //   node.position({
      //     x: newX,
      //     y: currentPosition.y
      //   });
      // });
    }

    const domainNodes = hostNode.children('[type="domain"]');
    const domainNodeSpacing = domainNodes.length > 1 ? (availableWidth - padding *2 ) / (domainNodes.length + 1) : availableWidth / 2;

    domainNodes.forEach((node, index) => {
      const currentPosition = node.position();
      const newX = hostBB.x1 + padding + domainNodeSpacing * (index + 1);

      node.position({
        x: newX,
        y: currentPosition.y
      });
    });
  });

  // No need to call cy.fit() as we're making minimal changes
};

export default function TopologySection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['topologyData'],
    queryFn: fetchTopologyData,
  });
  const [isMaximized, setIsMaximized] = useState(false);

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
    <div style={{ marginTop: '-32px' }}>
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
            {isLoading && <div>Loading topology...</div>}
            {error && <div>Error fetching topology data.</div>}
            {data && (
              <CytoscapeComponent
                elements={data || []}
                stylesheet={stylesheet}
                layout={layout}
                style={{ width: '100%', height: '100%' }}
                cy={(cy) => {
                  cy.maxZoom(2);
                  cy.minZoom(0.2);

                  // Apply auto-layout within host containers after main layout
                  cy.ready(() => {
                    // Add a small delay to ensure the main layout is complete
                    setTimeout(() => {
                      applyHostContainerLayouts(cy);
                    }, 100);
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