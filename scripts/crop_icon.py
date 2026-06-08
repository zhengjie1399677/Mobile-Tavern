import collections
from PIL import Image
import os

image_path = 'C:/Users/20573/.gemini/antigravity-ide/brain/4ac81919-419a-4bfa-98c1-42e36660458d/media__1780538261892.jpg'
output_path = 'e:/modules/projects/Mobile-Tavern/app-icon.png'

def run():
    print("Loading source image using PIL...")
    if not os.path.exists(image_path):
        print(f"Error: Source image not found at {image_path}")
        return
        
    img = Image.open(image_path).convert("RGBA")
    width, height = img.size
    print(f"Original dimensions: {width}x${height}")

    # Bounding box calculation based on pixel brightness (R+G+B > 80)
    min_x, max_x = width, 0
    min_y, max_y = height, 0

    for y in range(height):
        for x in range(width):
            r, g, b, a = img.getpixel((x, y))
            if r + g + b > 80:
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y

    print(f"Detected bounding box: X [{min_x}, {max_x}], Y [{min_y}, {max_y}]")
    crop_w = max_x - min_x + 1
    crop_h = max_y - min_y + 1
    print(f"Crop dimensions: {crop_w}x{crop_h}")

    if crop_w <= 0 or crop_h <= 0:
        print("Error: Could not detect any valid content in the image.")
        return

    # Expand to a perfect square centered on the bounding box
    size = max(crop_w, crop_h)
    center_x = min_x + crop_w // 2
    center_y = min_y + crop_h // 2

    start_x = max(0, center_x - size // 2)
    start_y = max(0, center_y - size // 2)

    # Adjust if start position + size exceeds original dimensions
    if start_x + size > width:
        start_x = width - size
    if start_y + size > height:
        start_y = height - size

    print(f"Square crop area: start=({start_x}, {start_y}), size={size}")
    cropped = img.crop((start_x, start_y, start_x + size, start_y + size))
    cropped = cropped.copy()

    # BFS Flood fill to make background transparent
    c_width, c_height = cropped.size
    visited = set()
    queue = collections.deque()

    # Enqueue border pixels to start flood fill from the outside edges
    for x in range(c_width):
        queue.append((x, 0))
        queue.append((x, c_height - 1))
        visited.add((x, 0))
        visited.add((x, c_height - 1))
    for y in range(c_height):
        queue.append((0, y))
        queue.append((c_width - 1, y))
        visited.add((0, y))
        visited.add((c_width - 1, y))

    # Threshold for dark background pixels: R < 30, G < 30, B < 35
    pixels = cropped.load()
    transparent_count = 0

    while queue:
        x, y = queue.popleft()
        r, g, b, a = pixels[x, y]
        
        # If the pixel is part of the dark background, make it transparent and expand
        if r < 30 and g < 30 and b < 35:
            pixels[x, y] = (0, 0, 0, 0)
            transparent_count += 1
            
            for nx, ny in [(x+1, y), (x-1, y), (x, y+1), (x, y-1)]:
                if 0 <= nx < c_width and 0 <= ny < c_height:
                    if (nx, ny) not in visited:
                        visited.add((nx, ny))
                        queue.append((nx, ny))

    print(f"Made {transparent_count} background pixels transparent.")
    cropped.save(output_path, "PNG")
    print(f"Successfully saved cropped image to: {output_path}")

if __name__ == '__main__':
    run()
