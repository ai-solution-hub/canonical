import { redirect } from 'next/navigation';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const params = await searchParams;
  const target = params?.q
    ? `/browse?q=${encodeURIComponent(params.q)}`
    : '/browse';
  redirect(target);
}
