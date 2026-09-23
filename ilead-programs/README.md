# Trang chi tiết chương trình iLEAD

Bốn trang `chuong-trinh/ilead-1/` … `chuong-trinh/ilead-4/` và `404.html` được **sinh ra** từ một
nguồn dữ liệu và một bộ template. Không sửa trực tiếp các file sinh ra — sửa nguồn rồi chạy build.

## Sửa nội dung

| Muốn sửa | Sửa ở đâu |
|---|---|
| Chủ đề, quyền lợi, thông điệp, đầu ra, đối tượng, ảnh của một cấp độ | `programs.json` → `programs[]` |
| Nhãn dùng chung (tiêu đề phần, CTA, nút quay lại…) | `programs.json` → `shared` |
| Tên miền dùng cho canonical / og:url | `programs.json` → `site.url` |
| Bố cục một trang chương trình | `templates/program.html` |
| Header / footer của các trang chi tiết và 404 | `templates/layout.html` |
| Nội dung trang 404 | `templates/not-found.html` |
| Giao diện | `../uploads/ilead-program.css` |

Sau khi sửa, chạy (cần Node.js 18+, không cần cài thêm gì):

```
node ilead-programs/build.mjs
```

Kiểm tra các file sinh ra đã khớp nguồn chưa (dùng trước khi commit):

```
node ilead-programs/build.mjs --check
```

Build dừng lại và báo lỗi nếu dữ liệu sai (thiếu trường, không đủ 6 chủ đề / 4 quyền lợi,
trùng slug, ảnh không tồn tại…). Build cũng đồng bộ tham số `?v=` của `uploads/ilead-nav.js`
trong `index.html` (trình duyệt dùng lại script trong cache khi bấm Back, nên phiên bản phải
đổi khi script đổi).

## Thêm cấp độ mới (ví dụ iLEAD 5)

1. Thêm một mục vào `programs[]` trong `programs.json`: `slug` (`ilead-5`), `order`, `name`,
   `referenceOutcome`, `tagline`, đúng 6 `topics`, đúng 4 `benefits`, `audience`, `accent`
   (màu nhấn `#RRGGBB`, dùng ở trang 404), và:
   - `topicIcons` (6) / `benefitIcons` (4): tên icon Material Symbols Rounded
     (tra tại https://fonts.google.com/icons), theo đúng thứ tự chủ đề / quyền lợi.
   - `banner`: ảnh banner hero (`src`, `alt`, `width`, `height`). Banner hiện tại 1672×941,
     để trống phía trái cho chữ, nhân vật ở bên phải.
   - `tagline` được tách thành 2 dòng tại dấu " – " đầu tiên (dòng đầu là tiêu đề lớn).
2. Chạy `node ilead-programs/build.mjs` → tạo `chuong-trinh/ilead-5/index.html`.
3. Thêm card vào phần "Lộ trình học" trong `index.html`, link dạng
   `<a class="ye-card-link" href="chuong-trinh/ilead-5/" data-ilead-program="ilead-5" …>`.
   Build sẽ cảnh báo nếu một cấp độ chưa có card trỏ tới.

Muốn đổi số chủ đề / quyền lợi bắt buộc: `TOPIC_COUNT`, `BENEFIT_COUNT` đầu file `build.mjs`.
Xoá một cấp độ khỏi `programs.json` thì build tự xoá thư mục trang đã sinh tương ứng.

## Điều hướng và khôi phục vị trí cuộn

Toàn bộ nằm trong `../uploads/ilead-nav.js` (dùng chung cho trang chính và trang chi tiết).
Tóm tắt cơ chế ở đầu file. Bật log để debug trong console trình duyệt:

```js
sessionStorage.setItem('ilead:debug', '1') // tải lại trang; xoá key để tắt
```

## Xem thử ở máy

Mở qua một web server tĩnh (không mở `file://`), ví dụ `npx serve .` tại thư mục gốc site,
rồi vào `/`, `/chuong-trinh/ilead-1/`…

## Route / hosting

- Trang tĩnh thật tại `chuong-trinh/<slug>/index.html` → Netlify và GitHub Pages phục vụ trực
  tiếp, refresh không 404, không cần redirect/rewrite. Không thêm rewrite SPA.
- Link trong trang chi tiết là đường dẫn tương đối (`../../`) nên chạy được cả ở gốc domain
  lẫn dưới thư mục con (GitHub Pages dạng `/<repo>/`).
- `404.html` ở gốc được Netlify / GitHub Pages dùng cho mọi URL không tồn tại; nó tự xác định
  đường dẫn gốc của site để link và ảnh không bị vỡ ở URL lồng nhau.
