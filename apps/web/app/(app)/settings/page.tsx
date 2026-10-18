import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-navy">الإعدادات والمنظمة</h1>
      <Card>
        <EmptyState title="قيد التوفر" description="إدارة الأعضاء والأدوار متوقفة على endpoints غير متاحة حالياً. لا يتم حفظ إعدادات غير مدعومة." />
      </Card>
    </div>
  );
}
