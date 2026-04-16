import { redirect } from 'next/navigation';

export default function ActivityPage() {
  redirect('/provenance?tab=audit');
}
