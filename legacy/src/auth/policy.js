import { canManage } from '../../../shared/server/auth/policy.js';
import { HttpError } from '../validators/index.js';
export { canManage };
export function assertManage(user, action, resource, record) {
  if (!canManage(user, action, resource, record)) throw new HttpError(403, user?.role === 'editor' && resource === 'dishes' && !user.chef_id ? 'Tài khoản chưa được gắn đầu bếp. Vui lòng liên hệ quản trị viên.' : 'Bạn không có quyền thực hiện thao tác này.');
}
