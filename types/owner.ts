/** Content owner statistics returned by the get_content_owner_stats RPC */
export interface ContentOwnerStats {
  owner_id: string;
  total_items: number;
  fresh_count: number;
  aging_count: number;
  stale_count: number;
  expired_count: number;
  unverified_count: number;
  display_name?: string;
}
