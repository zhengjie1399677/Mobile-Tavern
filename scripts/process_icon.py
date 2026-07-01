import os
import sys
from PIL import Image

# Reconfigure stdout to use UTF-8 to prevent encoding errors on Windows
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, '..'))
    
    logo_path = os.path.join(project_root, 'public', 'logo.png')
    app_icon_path = os.path.join(project_root, 'app-icon.png')
    
    if not os.path.exists(logo_path):
        print(f"Error: logo.png not found at {logo_path}")
        sys.exit(1)
        
    # Open the logo image
    img = Image.open(logo_path).convert("RGBA")
    width, height = img.size
    
    # 1. Get the background color from the top-left pixel
    r, g, b, _ = img.getpixel((0, 0))
    bg_hex = f"#{r:02x}{g:02x}{b:02x}"
    print(f"Sampled background color: RGB({r}, {g}, {b}) -> Hex {bg_hex}")
    
    # 2. Resize the logo to 60% of the target canvas size (1024x1024) to add padding
    target_canvas_size = 1024
    scale_factor = 0.60
    target_logo_size = int(target_canvas_size * scale_factor)
    
    print(f"Resizing logo from {width}x{height} to {target_logo_size}x{target_logo_size}...")
    resized_logo = img.resize((target_logo_size, target_logo_size), Image.Resampling.LANCZOS)
    
    # 3. Create a new image with the sampled background color
    padded_img = Image.new("RGBA", (target_canvas_size, target_canvas_size), (r, g, b, 255))
    
    # 4. Center the resized logo on the background canvas
    offset = (target_canvas_size - target_logo_size) // 2
    padded_img.paste(resized_logo, (offset, offset), resized_logo)
    
    # 5. Convert to RGB to discard alpha channel
    final_img = padded_img.convert("RGB")
    
    # 6. Save as app-icon.png
    final_img.save(app_icon_path, "PNG")
    print(f"Generated padded app-icon.png at {app_icon_path}")
    
    # 7. Write the background color to ic_launcher_background.xml files
    xml_content = f"""<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="ic_launcher_background">{bg_hex}</color>
</resources>
"""
    
    paths_to_update = [
        os.path.join(project_root, 'src-tauri', 'icons', 'android', 'values', 'ic_launcher_background.xml'),
        os.path.join(project_root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res', 'values', 'ic_launcher_background.xml')
    ]
    
    for p in paths_to_update:
        try:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'w', encoding='utf-8') as f:
                f.write(xml_content)
            print(f"Updated background color in {p}")
        except Exception as e:
            print(f"Failed to update {p}: {e}")

if __name__ == '__main__':
    main()
