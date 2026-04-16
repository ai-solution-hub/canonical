import { permanentRedirect } from 'next/navigation';

export default function BatchCreatePage() {
  permanentRedirect('/item/new?tab=batch');
}
