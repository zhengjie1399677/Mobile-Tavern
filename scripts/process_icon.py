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
    pixel = img.getpixel((0, 0))
    r, g, b = pixel[0], pixel[1], pixel[2]
    # Check if transparent (alpha < 255)
    if len(pixel) > 3 and pixel[3] < 255:
        bg_hex = "#0d1726"
        r, g, b = 13, 23, 38
        print(f"Top-left pixel is transparent (alpha={pixel[3]}). Defaulting background color to theme color: {bg_hex}")
    else:
        bg_hex = f"#{r:02x}{g:02x}{b:02x}"
        print(f"Sampled background color: RGB({r}, {g}, {b}) -> Hex {bg_hex}")
    
    # Determine the phase from command line arguments
    phase = 1
    if len(sys.argv) > 1:
        val = sys.argv[1].strip()
        if val == '2':
            phase = 2
        elif val == '1':
            phase = 1
            
    if phase == 1:
        # Phase 1: Create a full-size app-icon.png (scale 1.0) for Tauri to generate all static/legacy icons
        target_canvas_size = 1024
        scale_factor = 1.0
        target_logo_size = int(target_canvas_size * scale_factor)
        
        print(f"[Phase 1] Resizing logo from {width}x{height} to {target_logo_size}x{target_logo_size}...")
        resized_logo = img.resize((target_logo_size, target_logo_size), Image.Resampling.LANCZOS)
        
        # Create a new image with the sampled background color
        padded_img = Image.new("RGBA", (target_canvas_size, target_canvas_size), (r, g, b, 255))
        
        # Center the resized logo on the background canvas
        offset = (target_canvas_size - target_logo_size) // 2
        padded_img.paste(resized_logo, (offset, offset), resized_logo)
        
        # Convert to RGB to discard alpha channel
        final_img = padded_img.convert("RGB")
        
        # Save as app-icon.png
        final_img.save(app_icon_path, "PNG")
        print(f"Generated full-size app-icon.png at {app_icon_path}")
        
    elif phase == 2:
        # Phase 2: Overwrite only the adaptive foreground icons with a 60% scaled and transparent background logo
        print("[Phase 2] Overwriting adaptive foreground icons with padded transparent version...")
        
        # Mipmap folder density sizes for ic_launcher_foreground.png
        densities = {
            'mipmap-mdpi': 108,
            'mipmap-hdpi': 162,
            'mipmap-xhdpi': 216,
            'mipmap-xxhdpi': 324,
            'mipmap-xxxhdpi': 432
        }
        
        for folder, canvas_size in densities.items():
            scale_factor = 0.60
            target_logo_size = int(canvas_size * scale_factor)
            
            # Resize the original logo
            resized_logo = img.resize((target_logo_size, target_logo_size), Image.Resampling.LANCZOS)
            
            # Create a transparent canvas
            foreground_img = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
            
            # Center the logo on the transparent canvas
            offset = (canvas_size - target_logo_size) // 2
            foreground_img.paste(resized_logo, (offset, offset), resized_logo)
            
            # Paths to update (both source icons and generated build res)
            paths_to_update = [
                os.path.join(project_root, 'src-tauri', 'icons', 'android', folder, 'ic_launcher_foreground.png'),
                os.path.join(project_root, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res', folder, 'ic_launcher_foreground.png')
            ]
            
            for p in paths_to_update:
                try:
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    foreground_img.save(p, "PNG")
                    print(f"Overwrote adaptive foreground icon at {p} ({canvas_size}x{canvas_size}, logo size {target_logo_size}x{target_logo_size})")
                except Exception as e:
                    print(f"Failed to update {p}: {e}")

    # Write the background color to ic_launcher_background.xml files (Runs in both Phase 1 and 2)
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

