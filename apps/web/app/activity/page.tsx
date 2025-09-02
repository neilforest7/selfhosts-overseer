"use client";

import { ActivityLogSection } from '../sections/ActivityLogSection';

export default function ActivityPage() {
  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Activity Log</h1>
        <p className="text-gray-600 mt-2">
          View all system activities and changes across your infrastructure
        </p>
      </div>
      
      <ActivityLogSection 
        showFilters={true}
        limit={100}
        title="All Activities"
      />
    </div>
  );
}
