/**
 * getCroppedImg — pure canvas helper; no React dependency.
 *
 * Loads `imageSrc` into an off-screen Image, draws the crop region onto a
 * canvas, then resolves a File containing the encoded result.
 */

interface CropPixels {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GetCroppedImgOptions {
  outputSize?: { w: number; h: number };
  type?: string;
  fileName?: string;
}

export function getCroppedImg(
  imageSrc: string,
  cropPixels: CropPixels,
  opts?: GetCroppedImgOptions,
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvasW = opts?.outputSize?.w ?? cropPixels.width;
      const canvasH = opts?.outputSize?.h ?? cropPixels.height;
      const mimeType = opts?.type ?? 'image/png';
      const fileName = opts?.fileName ?? 'image.png';

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get 2D canvas context'));
        return;
      }

      ctx.drawImage(
        img,
        cropPixels.x,
        cropPixels.y,
        cropPixels.width,
        cropPixels.height,
        0,
        0,
        canvasW,
        canvasH,
      );

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('canvas.toBlob produced a null blob'));
            return;
          }
          resolve(new File([blob], fileName, { type: mimeType }));
        },
        mimeType,
        0.92,
      );
    };

    img.onerror = () => {
      reject(new Error(`Failed to load image: ${imageSrc}`));
    };

    img.src = imageSrc;
  });
}

export default getCroppedImg;
