import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">التحليلات</h1>
      <Card>
        <EmptyState title="قيد التوفر" description="لا توجد endpoints للتحليلات المجمّعة حالياً. لن يتم عرض مقاييس مختلقة." />
      </Card>
    </div>
  );
}
