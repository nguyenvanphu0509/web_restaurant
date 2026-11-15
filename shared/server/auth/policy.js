export function canManage(user, action, resource, record) {
  if (!user || !['viewer', 'editor', 'admin'].includes(user.role)) return false;
  if (action === 'read') return true;
  if (user.role === 'admin') return true;
  if (user.role !== 'editor' || action === 'delete') return false;
  if (resource !== 'dishes') return true;
  if (!user.chef_id) return false;
  return action === 'create' || (record?.chefId === user.chef_id && record?.status === 'draft');
}
