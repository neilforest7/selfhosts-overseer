"use client";

import { ActivityLogSection } from '../sections/ActivityLogSection';

export default function ActivityPage() {
  return (
    <div className="container mx-auto py-6">
      <ActivityLogSection 
        showFilters={true}
        limit={100}
        title="All Activities"
      />
    </div>
  );
}
