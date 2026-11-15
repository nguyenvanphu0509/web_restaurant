# Ẩm thực Việt — Cách chạy dự án

Dùng **Node.js 24.x**, chạy lệnh tại thư mục gốc.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `api/` | Express REST API, Prisma/PostgreSQL, xác thực JWT |
| `web/` | React/Vite, gọi API bằng `fetch` |
| `legacy/` | SSR Express/EJS, xác thực session/cookie |
| `shared/` | Cấu hình dùng chung, chính sách nguồn ảnh |
| `tests/`, `scripts/` | Kiểm thử và công cụ chạy dự án |

Trong mỗi ứng dụng: `src/` chứa code, `public/` chứa ảnh/CSS/JS trình duyệt. Migration tạo/sửa cấu trúc database; seed nạp dữ liệu mẫu.

## Lệnh cần dùng

```sh
npm ci                              # Cài dependency
npm run dev                         # API :3000 + React :5173
npm run dev:ssr                     # SSR :3001
npm run build                       # Build React
npm test                            # Kiểm thử cấp dự án
npm --prefix legacy run test:flow    # Kiểm thử SSR bằng DB/email giả và Chrome
npm run db:generate                 # Sinh Prisma Client
npm run db:check                    # Kiểm tra kết nối database
```

Cấu hình theo `.env.example` trong `api/`, `web/`, `legacy/`. Giữ `.env` đang có, không commit secret. SSR cần session secret, SMTP và reCAPTCHA; frontend chỉ nhận cấu hình công khai.

Chỉ chạy `db:push`, `db:seed` hoặc `auth:migrate` khi cần thiết lập/cập nhật database, không chạy lại chỉ để mở website. Script nhập món có thể ghi dữ liệu; dùng `node api/scripts/import-user-dishes.js --dry-run` để kiểm tra trước.

Ảnh lỗi: kiểm tra URL và `shared/image-sources.js`. Không nhận OTP: kiểm tra SMTP, thư rác, thời gian chờ gửi lại. Giao diện không đổi: kiểm tra đúng ứng dụng React/SSR và đúng cổng.

Đọc tiếp: [Kiến thức quan trọng](docs/KIEN_THUC.md).

Kế hoạch triển khai slide 1–35: xác thực JWT cho Restaurant App CSR
1. Phạm vi và điểm cần sửa
Bộ slide hiện tại đã đổi thứ tự: slide 1–25 giới thiệu JWT; slide 26–35 là bài 1: xác thực cho CSR, chưa triển khai MFA hoặc phân quyền theo role. Kế hoạch này thay thế phần tương ứng trong kế hoạch trước. Nguồn slide.
Mục tiêu là hoàn thiện trên hai phần api và web hiện có, giữ nguyên giao diện đăng ký/đăng nhập, avatar, CRUD, tìm kiếm và phân trang.
Qua đối chiếu code, cần điều chỉnh:
Hiện tại	Hướng xử lý
API dùng role để chặn tạo/sửa/xóa	Mọi tài khoản active được CRUD trong phạm vi bài này
GET danh sách/chi tiết món cần token	Cho phép truy cập công khai
Middleware JWT không tải tài khoản	Verify độc lập, sau đó tải user từ DB
Sai mật khẩu trả 401	Trả HTTP 200, INVALID_CREDENTIALS
Pending gộp chung với sai mật khẩu	Tách ACCOUNT_NOT_ACTIVATED
Email đăng ký trùng trả 409	Phản hồi chung như email mới
Token reset lỗi trả INVALID_RESET	Đổi thành INVALID_RESET_TOKEN, HTTP 200
CAPTCHA thiếu và sai dùng cùng mã	Tách CAPTCHA_REQUIRED và INVALID_CAPTCHA
Không làm trong đợt này: MFA, recovery code, ABAC, thêm trạng thái draft/published hoặc chức năng phân quyền SSR.
2. Chốt hợp đồng API trước khi triển khai
Giữ hợp đồng lỗi của Block 6:
{
  "ok": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Email hoặc mật khẩu không đúng"
  }
}
Thành công dùng { "ok": true, "data": ... }; không thay đổi cấu trúc dữ liệu tìm kiếm/phân trang hiện có.
Các endpoint tài khoản
Endpoint	Dữ liệu chính	Khi thành công
POST /api/auth/register	email, name, password, confirmPassword, captcha	Tiếp nhận yêu cầu; không cấp token
POST /api/auth/activate	email, otp	Kích hoạt; không cấp token
POST /api/auth/activate/resend	email	Tiếp nhận gửi lại OTP
POST /api/auth/login	email, password, captcha khi cần	Cấp access token
POST /api/auth/forgot	email	Phản hồi chung
POST /api/auth/reset	token, password, confirmPassword	Đổi mật khẩu; không tự đăng nhập
GET /api/auth/me	Bearer token	Thông tin user hiện tại từ DB
Dùng captcha làm tên trường chính; tạm hỗ trợ g-recaptcha-response để tương thích form hiện có. SPA chuyển sang gửi trường chính.
Status và mã lỗi
Tình huống	HTTP	error.code
Email/mật khẩu không đúng	200	INVALID_CREDENTIALS
Mật khẩu đúng, tài khoản chưa kích hoạt	200	ACCOUNT_NOT_ACTIVATED
Thiếu CAPTCHA khi bắt buộc	200	CAPTCHA_REQUIRED
CAPTCHA không hợp lệ	200	INVALID_CAPTCHA
OTP sai/hết hạn/đã dùng	200	INVALID_OTP
Reset token sai/hết hạn/đã dùng	200	INVALID_RESET_TOKEN
Lỗi dữ liệu/bản ghi không tồn tại	200	VALIDATION_FAILED / NOT_FOUND
Thiếu token, sai chữ ký, user không còn hợp lệ	401	UNAUTHENTICATED
Token hết hạn	401	TOKEN_EXPIRED
Không đủ quyền, nếu phát sinh ở chức năng khác	403	FORBIDDEN
Vượt giới hạn	429	RATE_LIMITED
DB, SMTP hoặc dịch vụ CAPTCHA gặp sự cố	5xx	Lỗi kỹ thuật riêng
Sai thông tin đăng nhập không được làm frontend hiểu thành hết phiên. Đối chiếu slide 13–18.
3. Thứ tự triển khai backend
Bước 1 — Chuẩn hóa nghiệp vụ từ Block 8
* Đối chiếu trực tiếp logic SSR hiện có về hash mật khẩu, OTP, reset, CAPTCHA và bộ đếm sai.
* Tách phần nghiệp vụ có thể tái sử dụng khỏi render EJS, redirect, session và CSRF.
* API sử dụng lại nghiệp vụ đó qua JSON; không đưa middleware session-cookie vào API.
* Giữ hành vi của bản SSR, không bổ sung tính năng SSR ngoài phạm vi chuyển logic.
* Công bố bảng “mô-đun lấy từ Block 8 / phần thay đổi khi sang API” để dùng làm tài liệu nộp.
Đầu ra: dịch vụ tài khoản và bộ kiểm tra nghiệp vụ thống nhất, tránh hai bản xử lý khác nhau giữa SSR và API.
Bước 2 — Tách verify JWT và tải tài khoản
Chuỗi xử lý request được bảo vệ:
Đọc Authorization
→ Verify chữ ký và thời hạn JWT
→ Lấy sub đã được verify
→ Tải user từ database
→ Kiểm tra tài khoản active
→ Chạy handler CRUD
* Hàm verify JWT không truy vấn DB.
* Bước tải user là middleware riêng, chỉ chạy sau khi token hợp lệ.
* Cố định HS256; kiểm tra exp, iss, aud; từ chối none và thuật toán không được cấu hình.
* Dùng thư viện JWT thay phần tự ghép/ký token hiện tại; cập nhật các nơi gọi và test theo giao diện bất đồng bộ.
* Phân biệt token hết hạn với token sai chữ ký.
* User đã xóa, bị khóa hoặc chưa active không được qua middleware.
* Role lấy từ DB để trả thông tin tài khoản, chưa dùng role để phân quyền CRUD.
* DB gặp lỗi trả lỗi kỹ thuật; không giả thành token sai hoặc tự đăng xuất.
Chính sách mặc định: giữ JWT 15 phút, không thêm refresh token hoặc danh sách thu hồi. Đổi mật khẩu không vô hiệu hóa JWT cũ ngay; tài khoản active vẫn dùng token đến hạn. Khóa/xóa tài khoản có hiệu lực từ request tiếp theo vì middleware đọc user.
Bước 3 — Hoàn thiện đăng ký và kích hoạt
Đăng ký:
* Chuẩn hóa email; kiểm tra mật khẩu và xác nhận mật khẩu.
* Xác minh CAPTCHA ở server trước khi hash mật khẩu.
* Bỏ qua role trong body; tài khoản mới luôn là viewer, trạng thái pending.
* Email mới và email đã tồn tại trả cùng status, cấu trúc và thông báo chung.
* Không thay mật khẩu hoặc role của tài khoản đã tồn tại.
* Việc gửi email thực hiện sau phản hồi qua cơ chế tác vụ hiện có; lỗi SMTP được ghi nhận an toàn, không làm lộ email có tồn tại hay không.
* Thông báo trên SPA dùng nghĩa “đã tiếp nhận yêu cầu”, không khẳng định email chắc chắn đã vào hộp thư.
OTP:
* Giữ OTP 6 chữ số, hạn 10 phút, gửi lại cách nhau ít nhất 60 giây.
* Chỉ lưu hash/HMAC; không ghi OTP vào log.
* Mã sai, hết hạn hoặc đã dùng trả INVALID_OTP.
* Giữ giới hạn thử và khóa tạm của Block 8.
* Xác minh và đánh dấu sử dụng trong transaction; hai request đồng thời không thể cùng dùng thành công một mã.
* Gửi mã mới vô hiệu mã cũ; gửi thất bại không được phá mã trước còn hợp lệ.
* Kích hoạt không tạo session hoặc access token.
Bước 4 — Hoàn thiện đăng nhập và giới hạn thử
* Kiểm tra mật khẩu bằng hash hiện có.
* Sai mật khẩu hoặc email không tồn tại dùng cùng thông báo INVALID_CREDENTIALS.
* Chỉ trả ACCOUNT_NOT_ACTIVATED sau khi mật khẩu đúng.
* Chỉ cấp JWT khi tài khoản đã kích hoạt.
* Register, Activate và Login luôn là anonymous request, kể cả khi browser còn token cũ.
* Dùng đúng cơ chế bộ đếm sai của Block 8; sửa việc API hiện đếm mọi lần gọi Login thành đếm lỗi theo cùng quy tắc SSR.
* Giữ các ngưỡng hiện có: CAPTCHA sau 3 lỗi theo email hoặc 10 lỗi theo IP; khóa tạm theo ngưỡng 10/50 lỗi và cửa sổ 15 phút.
* Không cho đổi client, gọi API trực tiếp hoặc tải lại trang làm mất bộ đếm.
Bước 5 — Hoàn thiện quên và đặt lại mật khẩu
* forgot trả nội dung/status giống nhau cho email có và không có tài khoản; vẫn áp dụng giới hạn yêu cầu.
* Email chứa link tới SPA /reset?token=....
* GET trang reset chỉ hiển thị form; không tiêu thụ token.
* Chỉ POST reset thành công mới đổi password và đánh dấu token đã dùng.
* Token sai, hết hạn hoặc dùng lại trả INVALID_RESET_TOKEN; password không thay đổi.
* Dùng transaction để chặn hai request reset đồng thời.
* Giữ token reset ngẫu nhiên, lưu hash, hạn 15 phút.
* Reset không cấp access token; SPA yêu cầu đăng nhập lại bằng mật khẩu mới.
Bước 6 — Điều chỉnh bảo vệ CRUD và CORS
Nhóm endpoint	Quy tắc
GET danh sách/chi tiết dishes	Công khai
POST/PATCH/DELETE dishes	Cần user active
Mọi endpoint chefs, ingredients	Cần user active
CRUD restaurants hiện có	Giữ yêu cầu đăng nhập, bỏ phân biệt role
Config, home, gợi ý tìm kiếm, ảnh tĩnh	Giữ công khai
	•	Bỏ middleware yêu cầu Editor/Admin trên CRUD trong phạm vi bài này.
* Viewer active cũng tạo, sửa và xóa được.
* Kiểm tra xác thực trước upload hoặc thao tác ghi.
* Giữ validation, transaction, kiểm tra liên kết và cơ chế preview chỉ đọc.
* CORS chỉ cho origin SPA đã cấu hình; cho phép Authorization, Content-Type.
* OPTIONS không yêu cầu token và không thực hiện thao tác dữ liệu.
4. Triển khai frontend sau khi API đạt kiểm tra HTTP
Điều hướng và các trang
* Giữ giao diện đăng ký, đăng nhập, nhập lại mật khẩu, banner và menu avatar hiện tại.
* /dishes và /dishes/:id truy cập được khi chưa đăng nhập.
* Link “Món ăn” đi thẳng tới danh sách, không chuyển Login trước.
* /admin/* tiếp tục có route guard.
* Các nút quản trị hiển thị theo trạng thái đăng nhập, không phân biệt Viewer/Editor/Admin ở bài này.
* Pending được hướng tới bước kích hoạt; sai mật khẩu vẫn ở form Login.
Lớp gọi API và phiên đăng nhập
* Gắn Bearer tại một lớp duy nhất.
* Các request tài khoản anonymous không gửi token.
* Request GET món công khai không cần Bearer.
* Chỉ cho phép gửi token tới API origin đã cấu hình; không nhận URL tùy ý dẫn tới domain khác.
* Sau đăng nhập hoặc khôi phục phiên, lấy thông tin tài khoản qua /api/auth/me.
* Có trạng thái đang kiểm tra phiên để tránh route guard chuyển Login trước khi kiểm tra xong.
* Không coi việc decode JWT ở browser là xác minh chữ ký.
Xử lý lỗi và lưu token
* 401: xóa phiên hiện tại; đang ở trang quản trị thì chuyển Login và giữ đường dẫn quay lại.
* 403: báo thiếu quyền, không xóa token.
* Lỗi HTTP 200 với ok:false: hiện lỗi nghiệp vụ theo error.code.
* Lỗi mạng/500: giữ phiên và cho thử lại.
* Giữ kiểm tra chống phản hồi 401 cũ làm xóa phiên đăng nhập mới.
* Giữ lựa chọn hiện có: sessionStorage khi không ghi nhớ, localStorage khi ghi nhớ.
* Logout xóa cả hai nơi lưu; không lưu mật khẩu, OTP hoặc reset token vào storage.
* Render dữ liệu người dùng bằng cơ chế escape của React; không chèn dữ liệu đó vào HTML thô.
5. Kế hoạch kiểm thử
Kiểm tra API tự động
1. Register/Activate/Login không cần JWT; chỉ Login thành công cấp token.
2. Register gửi role: admin vẫn tạo Viewer.
3. CAPTCHA thiếu/sai không tạo user hoặc gửi OTP.
4. Email mới và email trùng nhận cùng phản hồi đăng ký; tài khoản cũ không bị sửa.
5. OTP sai, hết hạn, dùng lại trả đúng mã; kiểm tra cả hai request đồng thời.
6. Pending đăng nhập đúng mật khẩu không nhận token.
7. Sai mật khẩu trả HTTP 200; đến ngưỡng thì yêu cầu CAPTCHA hoặc trả 429.
8. forgot không tiết lộ tài khoản; reset GET không tiêu thụ token.
9. Reset token lỗi không đổi password; token chỉ dùng một lần.
10. JWT sửa nội dung/sai khóa/sai thuật toán/hết hạn bị từ chối.
11. Verify JWT không đọc DB; token không hợp lệ bị chặn trước khi tải user.
12. Token hợp lệ phải tải user; user bị khóa/xóa bị từ chối.
13. User active thuộc cả ba role đều CRUD được.
14. GET dishes không token vẫn giữ đúng tìm kiếm/phân trang.
15. CORS/preflight thành công với origin đúng và từ chối origin ngoài cấu hình.
Kiểm tra trình duyệt
* Chạy toàn bộ luồng đăng ký → OTP → đăng nhập → quản trị → logout.
* Quên mật khẩu → mở link → reset → đăng nhập bằng mật khẩu mới.
* Reload, mở link sâu /admin/..., hết hạn phiên và quay lại trang sau Login.
* Kiểm tra lỗi mạng/500 không làm mất phiên.
* Sửa role trong storage không ảnh hưởng quyết định của server.
* Kiểm tra giao diện desktop/mobile, menu avatar và ô nhập lại mật khẩu.
Dùng DB cô lập, SMTP/CAPTCHA giả lập cho kiểm tra tự động. Kiểm tra transaction và concurrency trên PostgreSQL thử nghiệm; không chỉ dựa vào DB trong bộ nhớ. Email/CAPTCHA thật kiểm tra riêng bằng tài khoản thử được chỉ định.
6. Bằng chứng nộp và điều kiện hoàn tất
Tạo thư mục bằng chứng theo từng kịch bản slide 32–35:
* Ảnh giao diện và Network thể hiện request/response.
* Application/Storage trước Login, sau Login và sau Logout.
* Request HTTP trực tiếp chứng minh backend bảo vệ độc lập với giao diện.
* Bản ghi DB thể hiện hash, thời hạn, số lần thử và usedAt.
* Che toàn bộ access token, OTP, reset token và credential.
* Sơ đồ Login JWT, giải thích Decode/Verify và ranh giới verify không đọc DB.
* Tài liệu giải thích nơi lưu token, rủi ro XSS và chính sách token cũ sau đổi mật khẩu.
* Danh sách logic chuyển từ Block 8.
* Một lỗi thực tế có bước tái hiện, nguyên nhân và bằng chứng sau sửa; có thể dùng lỗi hiện tại “Viewer active bị chặn CRUD” nếu lưu được bằng chứng trước sửa.
Hoàn tất khi: các kịch bản trên đạt, build thành công, bộ kiểm tra hồi quy không lỗi và tài liệu khớp hành vi thực tế. Không triển khai MFA/phân quyền để tránh vượt phạm vi slide 1–35.
Chưa sửa code hoặc chạy migration trong lượt lập kế hoạch này.</proposed_plan>
