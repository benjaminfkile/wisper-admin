import AdminGate from "@/components/AdminGate";
import AdminShell from "@/components/AdminShell";
import PolicyEditor from "@/components/PolicyEditor";

export default function PolicyPage() {
  return (
    <AdminGate>
      <AdminShell>
        <PolicyEditor />
      </AdminShell>
    </AdminGate>
  );
}
