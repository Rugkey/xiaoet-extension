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
        }
    ]
    
    for file_info in files_to_download:
        url = file_info["url"]
        filename = file_info["filename"]
        destination = tesseract_dir / filename
        
        try:
            download_file(url, destination)
        except Exception as e:
            print(f"Error downloading {url}: {str(e)}")
            continue
    
    print("\nTesseract download completed!")
    print("Files downloaded to:", tesseract_dir.absolute())

if __name__ == "__main__":
    main()