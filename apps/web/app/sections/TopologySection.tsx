'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
      'font-size': '10px',
      'text-wrap': 'wrap',
      'text-max-width': 80,
      'text-valign': 'center',
      color: '#555',
      width: 80,
      height: 80,
    },
  },
  // Node styles
  {
    selector: 'node[type!="group"][type!="host"][type!="compose-group"][type!="remote-port"][type!="logical-container"]',
    style: {
      width: 80,
      height: 80,
      label: 'data(label)',
      'font-size': '12px',
      'text-wrap': 'wrap',
      'text-max-width': 80,
      'text-valign': 'center',
      'text-margin-y': 0,
      color: '#fff',
      'background-color': '#3498db',
      'border-color': '#2980b9',
      'border-width': 2,
    },
  },
  {
    selector: 'node[type="domain"]',
    style: {
      shape: 'round-rectangle',
      'font-size': '12px',
      'text-wrap': 'wrap',
      'width': 140,
      'height': 40,
      'background-color': '#9b59b6',
      'border-color': '#8e44ad' 
    },
  },
  {
    selector: 'node[type="npm"]',
    style: { 'background-color': '#2ecc71', 'border-color': '#27ae60' },
  },
  {
    selector: 'node[type="frps"]',
    style: { 'background-color': '#e67e22', 'border-color': '#d35400' },
  },
  {
    selector: 'node[type="frpc"]',
    style: { 'background-color': '#f1c40f', 'border-color': '#f39c12' },
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
      label: '',
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
      label: '',
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
      label: 'data(label)',
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
      label: 'data(label)',
      'font-size': '12px',
      // 'width': 1.5,
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

export default function TopologySection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['topologyData'],
    queryFn: fetchTopologyData,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>网络拓扑</CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ height: '70vh', width: '100%', border: '1px solid #eee' }}>
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
              }}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}