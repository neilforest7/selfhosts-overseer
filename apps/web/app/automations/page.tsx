import AutomationsSection from '@/app/sections/AutomationsSection';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function AutomationsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Automations</h1>
      <p className="text-muted-foreground">
        Create rules to automate actions based on system events and conditions.
      </p>
      <AutomationsSection />
    </div>
  );
}
