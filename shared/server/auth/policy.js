export function canManageAction(user, action, resource) {
  if (!user || !['viewer', 'editor', 'admin'].includes(user.role)) return false;
  if (action === 'read') return true;
  if (user.role === 'admin') return true;
  if (user.role !== 'editor' || action === 'delete') return false;
  return resource !== 'dishes' || !!user.chef_id;
}

export function canManage(user, action, resource, record) {
  return canManageAction(user, action, resource) && (
    user.role !== 'editor' || resource !== 'dishes' || action === 'read' || action === 'create'
    || (record?.chefId === user.chef_id && record?.status === 'draft')
  );
}
