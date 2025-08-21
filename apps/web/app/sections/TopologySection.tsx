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
      'font-size': '16px',
      'font-weight': 'bold',
      color: '#333',
    },
  },
  // Host node styles (as containers for other nodes)
  {
    selector: 'node[type="host"]',
    style: {
      shape: 'rectangle',
      'background-color': '#dde6ed',
      'border-color': '#9db2bf',
      'border-width': 2,
      'border-style': 'solid',
      label: 'data(label)',
      'text-valign': 'top',
      'text-halign': 'center',
      'padding-top': '10px',
      'font-size': '14px',
      'font-weight': 'bold',
      color: '#27374d',
    },
  },
  // Compose group styles
  {
    selector: 'node[type="compose-group"]',
    style: {
      shape: 'rectangle',
      'background-color': '#d5e5f1',
      'border-color': '#d4e6f1',
      'border-width': 1,
      'border-style': 'dashed',
      label: 'data(label)',
      'text-valign': 'top',
      'text-halign': 'center',
      'padding-top': '5px',
      'font-size': '10px',
      color: '#5d6d7e',
    },
  },
  // Remote port styles
  {
    selector: 'node[type="remote-port"]',
    style: {
      shape: 'ellipse',
      width: 45,
      height: 45,
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
      'background-color': '#f9f9f9',
      'border-color': '#cccccc',
      'border-width': 2,
      'border-style': 'dashed',
      label: 'data(label)',
      'font-size': '10px',
      'text-wrap': 'wrap',
      'text-max-width': 80,
      'text-valign': 'center',
      color: '#555',
      width: 60,
      height: 60,
    },
  },
  // Node styles
  {
    selector: 'node[type!="group"][type!="host"][type!="compose-group"][type!="remote-port"][type!="logical-container"]',
    style: {
      width: 60,
      height: 60,
      label: 'data(label)',
      'font-size': '10px',
      'text-wrap': 'wrap',
      'text-max-width': 80,
      'text-valign': 'bottom',
      'text-margin-y': 5,
      color: '#fff',
      'background-color': '#3498db',
      'border-color': '#2980b9',
      'border-width': 2,
    },
  },
  {
    selector: 'node[type="domain"]',
    style: { 'background-color': '#9b59b6', 'border-color': '#8e44ad' },
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
      'curve-style': 'bezier',
      label: 'data(label)',
      'font-size': '8px',
      'edge-text-rotation': 'autorotate',
    },
  },
  {
    selector: 'edge[data.label="tunnel"]',
    style: {
      width: 4,
      // 'line-style': 'dashed',
      'line-color': '#a0b3c4',
      'target-arrow-color': '#a0b3c4',
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