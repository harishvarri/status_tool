import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div>
      <PageHeader title="Settings" description="Manage your PulseOps account" />

      <div className="max-w-xl space-y-4">
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">Account</CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm font-medium">{user?.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">User ID</span>
              <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                {user?.id?.slice(0, 16)}…
              </code>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">Monitoring</CardTitle>
            <CardDescription>How monitoring works</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="shrink-0 mt-0.5">Auto</Badge>
              <p>GitHub Actions runs Playwright every 5 minutes automatically across all your projects.</p>
            </div>
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="shrink-0 mt-0.5">Manual</Badge>
              <p>Use the &quot;Run Now&quot; button on any project to trigger an immediate check.</p>
            </div>
            <div className="flex items-start gap-3">
              <Badge variant="outline" className="shrink-0 mt-0.5">Realtime</Badge>
              <p>Dashboard updates automatically when new test results or errors are detected.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base">Health Score</CardTitle>
            <CardDescription>How your score is calculated</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>Test pass rate</span>
              <span className="font-medium text-foreground">70% weight</span>
            </div>
            <div className="flex justify-between">
              <span>Runtime errors</span>
              <span className="font-medium text-foreground">30% weight</span>
            </div>
            <div className="pt-2 border-t border-border space-y-1">
              <div className="flex justify-between">
                <span className="text-emerald-400">90–100%</span><span>Healthy</span>
              </div>
              <div className="flex justify-between">
                <span className="text-amber-400">70–89%</span><span>Warning</span>
              </div>
              <div className="flex justify-between">
                <span className="text-red-400">0–69%</span><span>Critical</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
