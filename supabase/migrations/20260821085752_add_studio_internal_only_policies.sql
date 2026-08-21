create policy "No direct client access to studio profiles"
on public.studio_profiles for all to anon, authenticated
using (false) with check (false);

create policy "No direct client access to studio items"
on public.studio_items for all to anon, authenticated
using (false) with check (false);

create policy "No direct client access to studio usage"
on public.studio_usage_events for all to anon, authenticated
using (false) with check (false);
