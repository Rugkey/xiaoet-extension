#!/usr/bin/env python3
"""
Download script for Tesseract OCR engine
This script downloads the necessary Tesseract files for OCR functionality

Part of the XiaoEt browser extension project.
Licensed under the MIT License.
See LICENSE file in the project root for full license information.
"""

import os
import sys
import requests
from pathlib import Path

def download_file(url, destination):
    """Download a file from URL to destination"""
    print(f"Downloading {url} to {destination}")
    response = requests.get(url, stream=True)
    response.raise_for_status()
    
    with open(destination, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)
    print(f"Download completed: {destination}")

def main():
    # Create necessary directories
    tesseract_dir = Path("src/content/tesseract")
    tesseract_dir.mkdir(parents=True, exist_ok=True)
    
    # Check if files already exist
    if not check_existing_files(tesseract_dir):
        print("Aborting download.")
        return
    
    # Define the URLs for Tesseract files
    # Note: These are example URLs - in a real implementation, 
    # you would use the actual Tesseract.js files
    files_to_download = [
        {
            "url": "https://cdn.jsdelivr.net/npm/tesseract.js@v4.1.1/dist/tesseract.min.js",
            "filename": "tesseract.min.js"
        },
        {
            "url": "https://cdn.jsdelivr.net/npm/tesseract.js-core@v4.0.1/tesseract-core.wasm.js",
            "filename": "tesseract-core.wasm.js"
        },
        # Language data for English
        {
            "url": "https://cdn.jsdelivr.net/npm/tesseract.js@v4.1.1/dist/lang-data/eng.traineddata.gz",
            "filename": "eng.traineddata.gz"
        }
    ]
    
    success_count = 0
    for file_info in files_to_download:
        url = file_info["url"]
        filename = file_info["filename"]
        destination = tesseract_dir / filename
        
        try:
            download_file(url, destination)
            success_count += 1
        except Exception as e:
            print(f"Error downloading {url}: {str(e)}")
            continue
    
    print(f"\nTesseract download completed! Successfully downloaded {success_count}/{len(files_to_download)} files.")
    print("Files downloaded to:", tesseract_dir.absolute())
    
    # Create/update the .gitignore for tesseract directory if needed
    gitignore_path = tesseract_dir / ".gitignore"
    with open(gitignore_path, "w") as f:
        f.write("# Tesseract data files\n")
        f.write("*.traineddata\n")
        f.write("*.gz\n")
        f.write("# Wasm files\n")
        f.write("*.wasm\n")
        
    print(f"Created .gitignore for tesseract directory: {gitignore_path}")


def check_existing_files(tesseract_dir):
    """Check if tesseract files already exist"""
    files = list(tesseract_dir.glob("*"))
    if files:
        print(f"Warning: {tesseract_dir} already contains {len(files)} files:")
        for f in files:
            print(f"  - {f.name}")
        response = input("Continue anyway? (y/N): ")
        return response.lower() == 'y'
    return True

if __name__ == "__main__":
    main()