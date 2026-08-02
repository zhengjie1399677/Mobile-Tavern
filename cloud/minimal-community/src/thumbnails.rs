use image::codecs::jpeg::JpegEncoder;

/// 缩略图最长边像素。社区双列网格封面远小于原图，256px 足够清晰且体积极小。
pub const THUMBNAIL_MAX_EDGE: u32 = 256;
/// JPEG 质量：在体积与清晰度之间取平衡。
pub const THUMBNAIL_QUALITY: u8 = 82;
/// 缩略图扩展名。JPEG 在 Android/iOS WebView 均原生支持，且体积最小。
pub const THUMBNAIL_EXTENSION: &str = "jpg";

/// 从完整 PNG 角色卡生成 JPEG 缩略图。
///
/// 角色卡 PNG 通常携带内嵌 JSON（可达数 MB），这里只解码像素部分并缩放，
/// 输出体积通常只有几十 KB。透明区域合成到白色背景，避免 JPEG 压缩后变黑。
pub fn generate_thumbnail(png_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let decoded = image::load_from_memory(png_bytes)
        .map_err(|error| format!("无法解码 PNG：{error}"))?;
    let thumbnail = decoded.thumbnail(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE);
    let rgba = thumbnail.to_rgba8();
    let (width, height) = rgba.dimensions();

    let mut rgb = image::RgbImage::new(width, height);
    for (x, y, pixel) in rgba.enumerate_pixels() {
        let alpha = pixel[3] as f32 / 255.0;
        let inverse = 1.0 - alpha;
        rgb.put_pixel(
            x,
            y,
            image::Rgb([
                (pixel[0] as f32 * alpha + 255.0 * inverse).round() as u8,
                (pixel[1] as f32 * alpha + 255.0 * inverse).round() as u8,
                (pixel[2] as f32 * alpha + 255.0 * inverse).round() as u8,
            ]),
        );
    }

    let mut output = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut output, THUMBNAIL_QUALITY);
    encoder
        .encode_image(&rgb)
        .map_err(|error| format!("无法编码 JPEG 缩略图：{error}"))?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn make_test_png(width: u32, height: u32) -> Vec<u8> {
        let mut rgba = image::RgbaImage::new(width, height);
        for (x, y, pixel) in rgba.enumerate_pixels_mut() {
            // 偶数像素带半透明，验证白色背景合成。
            let alpha = if (x + y) % 2 == 0 { 128 } else { 255 };
            *pixel = image::Rgba([(x % 256) as u8, (y % 256) as u8, 200, alpha]);
        }
        let mut output = Vec::new();
        rgba.write_to(&mut Cursor::new(&mut output), image::ImageFormat::Png)
            .expect("测试 PNG 编码失败");
        output
    }

    #[test]
    fn generates_small_jpeg_from_png() {
        let png = make_test_png(600, 400);
        let jpeg = generate_thumbnail(&png).unwrap();

        // JPEG SOI 标记
        assert!(jpeg.starts_with(&[0xFF, 0xD8]));
        let decoded = image::load_from_memory(&jpeg).unwrap();
        assert!(decoded.width() <= THUMBNAIL_MAX_EDGE);
        assert!(decoded.height() <= THUMBNAIL_MAX_EDGE);
        // 等比例缩放：长边恰好到达上限
        assert_eq!(decoded.width(), THUMBNAIL_MAX_EDGE);
        assert!(jpeg.len() < png.len());
    }

    #[test]
    fn rejects_non_png_input() {
        assert!(generate_thumbnail(b"this is not a png").is_err());
    }
}
