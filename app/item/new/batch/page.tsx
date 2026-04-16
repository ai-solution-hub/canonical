import { redirect } from 'next/navigation';

export default function BatchCreatePage() {
  redirect('/item/new?tab=batch');
}
