import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useLoad } from '../hooks.js';
import { AdminNav, dateLabel, money, Picture, StateView, Pager } from '../components.jsx';
import { resources } from '../../../shared/resources.js';

export function AdminList({ resource }) {
  const config = resources[resource], location = useLocation();
  const [params, setSearchParams] = useSearchParams();
  const query = params.get('q') || '';
  const clearedParams = new URLSearchParams(params);
  clearedParams.delete('q');
  clearedParams.delete('page');
  const columns = config.fields.filter(([key]) =>
    !['description', 'available', 'notableDishes', 'michelinUrl', 'ward', 'address', 'district'].includes(key)
  );

  const state = useLoad(`${resource}:${location.key}`, async signal => {
    const response = await api(`/admin/${resource}?${params}`, { signal });
    return resource === 'dishes'
      ? { ...response, paging: response.data, data: response.data.items }
      : { ...response, paging: response.meta };
  });
  const result = state.result;

  function search(event) {
    event.preventDefault();
    const term = new FormData(event.currentTarget).get('q').trim();
    const next = new URLSearchParams(clearedParams);
    if (term) next.set('q', term);
    if (next.toString() !== params.toString()) setSearchParams(next);
  }

  return <main id="main" tabIndex="-1" className="shell page-main admin-main">
    <AdminNav/>
    <div className="page-heading">
      <span className="section-badge">QUẢN TRỊ</span>
      <h1>Quản lý {config.singular}</h1>
      {result?.meta?.permissions.create && <Link className="button" to={`/admin/${resource}/new`}>Thêm {config.singular} ↗</Link>}
    </div>
    {location.state?.notice && <p className="success-message" role="status">{location.state.notice}</p>}
    {resource === 'dishes' && <form className="admin-search" role="search" aria-label="Tìm món trong quản trị" onSubmit={search}>
      <div className="field">
        <label htmlFor="admin-dish-search">Tìm món ăn</label>
        <input id="admin-dish-search" key={query} name="q" type="search" maxLength={120} defaultValue={query} placeholder="Nhập tên món"/>
      </div>
      <button className="button" type="submit">Tìm kiếm</button>
      {query && <Link className="button outline" to={{ pathname: location.pathname, search: clearedParams.toString() }}>Xóa tìm kiếm</Link>}
    </form>}
    <StateView state={state}/>
    {result && (!result.data.length
      ? <p className="empty-state">{resource === 'dishes' && query ? 'Không tìm thấy món ăn phù hợp.' : 'Chưa có bản ghi.'}</p>
      : <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>ID</th>{columns.map(([key, label]) => <th key={key}>{label}</th>)}<th>Thao tác</th></tr></thead>
          <tbody>{result.data.map(row => <tr key={row.id}>
            <td>#{row.id}</td>
            {columns.map(([key]) => <td key={key}>{key === 'name'
              ? <Link to={`/admin/${resource}/${row.id}`}>{row.name}</Link>
              : key === 'price' ? money(row.price) : row[key] || '—'}
            </td>)}
            <td><div className="actions">
              {row.permissions.update && <Link to={`/admin/${resource}/${row.id}/edit`}>Sửa</Link>}
              {row.permissions.delete && <Link to={`/admin/${resource}/${row.id}/delete`}>Xóa</Link>}
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>)}
    {result?.paging && <Pager label={`Phân trang ${config.label}`} page={result.paging.page}
      pages={Math.max(1, Math.ceil(result.paging.total / result.paging.pageSize))}
      href={page => {
        const next = new URLSearchParams(params);
        next.set('page', page);
        return `/admin/${resource}?${next}`;
      }}/>}
  </main>;
}
export function AdminRecord({ resource, deleting = false }) {
  const { id } = useParams(), location = useLocation(), navigate = useNavigate();
  const config = resources[resource], busy = useRef(false), mutation = useRef(null);
  const [pending, setPending] = useState(false), [error, setError] = useState(null);
  useEffect(() => { busy.current = false; setPending(false); setError(null); return () => mutation.current?.abort(); }, [id, deleting, location.key]);
  const path = `/admin/${resource}/${id}${deleting ? '/delete' : ''}`;
  const state = useLoad(`${path}:${location.key}`, signal => api(path, { signal }));
  const row = state.result?.data;
  async function destroy() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    const controller = new AbortController(); mutation.current = controller;
    try { await api(`/${resource}/${id}`, { method: 'DELETE', signal: controller.signal }); if (!controller.signal.aborted) navigate(`/admin/${resource}`, { state: { notice: 'Đã xóa bản ghi.' } }); }
    catch (error) { if (!controller.signal.aborted) setError(error); }
    finally { if (!controller.signal.aborted) { busy.current = false; setPending(false); } }
  }
  return <main id="main" tabIndex="-1" className="shell page-main admin-main"><AdminNav/><StateView state={error?.code === 'FORBIDDEN' ? { status: 'forbidden', error } : state}/>{row && error?.code !== 'FORBIDDEN' && <section className="form-card"><Link className="back-link" to={`/admin/${resource}`}>← Về danh sách</Link><h1>{deleting ? 'Xác nhận xóa' : row.name}</h1>{location.state?.notice && <p className="success-message" role="status">{location.state.notice}</p>}{deleting ? <><p>Bạn có chắc muốn xóa {config.singular} “{row.name}”?</p><p className="source-note">{resource === 'chefs' ? 'Các món ăn được giữ lại và bỏ liên kết đầu bếp.' : resource === 'ingredients' ? 'Các món ăn được giữ lại và bỏ liên kết nguyên liệu.' : resource === 'restaurants' ? 'Các món ăn được giữ lại và bỏ liên kết nhà hàng.' : 'Liên kết công thức của món này sẽ được xóa.'}</p>{error && <div role="alert"><p>{error.code === 'NOT_FOUND' ? 'Bản ghi đã bị xóa.' : error.message}</p><button className="button outline" onClick={state.retry}>Tải lại bản ghi</button></div>}<div className="form-actions"><button className="button danger-link" disabled={pending || state.result.meta?.preview || error?.code === 'NOT_FOUND'} onClick={destroy}>{pending ? 'Đang xóa…' : 'Xóa bản ghi'}</button><Link className="button outline" to={`/admin/${resource}`}>Hủy</Link></div></> : <>{['dishes', 'restaurants'].includes(resource) && <Picture className="image-editor-preview" src={row.imagePath} alt={row.name}/>}<dl className="record-meta"><div><dt>ID</dt><dd>#{row.id}</dd></div>{config.fields.map(([field, label, type]) => <div key={field}><dt>{label}</dt><dd>{field === 'price' ? money(row.price) : type === 'checkbox' ? row[field] ? 'Có' : 'Không' : Array.isArray(row[field]) ? row[field].join(', ') : row[field] || '—'}</dd></div>)}{resource === 'dishes' && <><div><dt>Quán phục vụ</dt><dd>{row.restaurant?.name || 'Chưa gắn'}</dd></div><div><dt>Đầu bếp</dt><dd>{row.chef?.name || 'Chưa gắn'}</dd></div><div><dt>Trạng thái</dt><dd>{row.status === 'draft' ? 'Nháp' : 'Đã xuất bản'}</dd></div><div><dt>Nguyên liệu</dt><dd>{row.ingredients?.map(x => x.ingredient.name).join(', ') || 'Chưa gắn'}</dd></div><div><dt>Giá demo / công thức demo</dt><dd>{row.priceIsDemo ? 'Có' : 'Không'} / {row.recipeIsDemo ? 'Có' : 'Không'}</dd></div></>}<div><dt>Ảnh</dt><dd>{row.imagePath || 'Mặc định'}</dd></div><div><dt>Ngày tạo</dt><dd>{dateLabel(row.createdAt)}</dd></div></dl><div className="form-actions"><Link className="button" to={`/admin/${resource}`}>Về danh sách ↗</Link>{state.result.meta.permissions.update && <Link className="button outline" to={`/admin/${resource}/${id}/edit`}>Sửa bản ghi ↗</Link>}{state.result.meta.permissions.delete && <Link className="button outline danger-link" to={`/admin/${resource}/${id}/delete`}>Xóa</Link>}<Link to={`/${resource}/${id}`}>Xem trang khách ↗</Link></div></>}</section>}</main>;
}
