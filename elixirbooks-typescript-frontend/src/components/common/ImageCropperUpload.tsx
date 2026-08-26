import { useRef, useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import Modal from '@components/admin/Modal';
import { toast } from 'sonner';
import { getCroppedImg } from '@lib/getCroppedImg';

interface ImageCropperUploadProps {
  /** Current image URL to display as thumbnail */
  value?: string;
  /** Crop aspect ratio (e.g. 1 for square, 16/9 for widescreen). Omit for free crop. */
  aspect?: number;
  /**
   * When true, the cropper reads the picked image's natural width/height and
   * defaults the crop box to that ratio (so a rectangular logo stays
   * rectangular), and shows a ratio selector. Ignored when `aspect` is set.
   */
  autoDetectAspect?: boolean;
  /** Desired output dimensions in pixels */
  outputSize?: { w: number; h: number };
  /** MIME type for the output file (default: original file type or 'image/png') */
  outputType?: string;
  /** File input accept attribute (default: 'image/*') */
  accept?: string;
  /** Button label (default: 'Upload / Change') */
  label?: string;
  /** Disable the upload button */
  disabled?: boolean;
  /** Called with the cropped File after the user confirms */
  onCropped: (file: File) => void;
}

// Ratio presets shown when autoDetectAspect is on. `undefined` = "Original"
// (the image's detected natural ratio).
const RATIO_PRESETS: { label: string; value: number | undefined }[] = [
  { label: 'Original', value: undefined },
  { label: '1:1', value: 1 },
  { label: '16:9', value: 16 / 9 },
  { label: '4:3', value: 4 / 3 },
];

const ImageCropperUpload: React.FC<ImageCropperUploadProps> = ({
  value,
  aspect,
  autoDetectAspect = false,
  outputSize,
  outputType,
  accept = 'image/*',
  label = 'Upload / Change',
  disabled = false,
  onCropped,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The object URL for the picked file, used as the Cropper image source
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  // The original File object (keeps name + type)
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  // Cropper state
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState<Area | null>(null);
  // Natural aspect of the picked image (width / height), detected on load.
  const [detectedAspect, setDetectedAspect] = useState<number | undefined>(undefined);
  // Selected ratio preset: undefined means "Original" (use detectedAspect).
  const [ratioOverride, setRatioOverride] = useState<number | undefined>(undefined);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // The aspect actually handed to the cropper. An explicit `aspect` prop always
  // wins; otherwise (autoDetect) use the chosen preset, falling back to the
  // image's detected natural ratio for "Original".
  const effectiveAspect = aspect ?? (autoDetectAspect ? (ratioOverride ?? detectedAspect) : undefined);

  const handleCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedPixels(pixels);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-picked later
    e.target.value = '';

    // Guard before we ever open the cropper: reject non-images and oversized files
    // up front with a clear message, instead of letting a bad file reach the server
    // (which would 400) or the canvas (which would fail to decode).
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file (JPG, PNG, WEBP, or GIF).');
      return;
    }
    const MAX_SIZE_MB = 10;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`Image is too large. Maximum size is ${MAX_SIZE_MB}MB.`);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPickedFile(file);
    setCropSrc(objectUrl);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedPixels(null);
    setDetectedAspect(undefined);
    setRatioOverride(undefined);
    setIsModalOpen(true);

    // Analyse the picked image: read its natural dimensions so the crop box can
    // default to the logo's real shape instead of forcing a square.
    if (autoDetectAspect) {
      const probe = new Image();
      probe.onload = () => {
        if (probe.naturalWidth && probe.naturalHeight) {
          setDetectedAspect(probe.naturalWidth / probe.naturalHeight);
        }
      };
      probe.src = objectUrl;
    }
  };

  const handleCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
    setPickedFile(null);
    setIsModalOpen(false);
  };

  const handleConfirm = async () => {
    if (!cropSrc || !croppedPixels || !pickedFile) return;

    setIsProcessing(true);
    try {
      const croppedFile = await getCroppedImg(cropSrc, croppedPixels, {
        outputSize,
        type: outputType ?? pickedFile.type,
        fileName: pickedFile.name,
      });
      onCropped(croppedFile);
      URL.revokeObjectURL(cropSrc);
      setCropSrc(null);
      setPickedFile(null);
      setIsModalOpen(false);
    } catch (err) {
      console.error('ImageCropperUpload: crop failed', err);
      toast.error('Could not crop the image. Please try another file.');
      handleCancel();
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled}
      />

      {/* Thumbnail + trigger button */}
      <div className="flex flex-col items-start gap-2">
        {value && (
          <img
            src={value}
            alt="Current image"
            // Hide instead of showing a broken-image icon if the stored URL 404s.
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            className={
              autoDetectAspect
                ? 'h-20 w-auto max-w-[220px] rounded-md object-contain border border-gray-200 bg-gray-50'
                : 'h-20 w-20 rounded-md object-cover border border-gray-200'
            }
          />
        )}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          {label}
        </button>
      </div>

      {/* Crop modal */}
      <Modal isOpen={isModalOpen} onClose={handleCancel} title="Crop Image" size="lg">
        <div className="flex flex-col gap-4">
          {/* Cropper area — react-easy-crop needs a relative+sized parent */}
          <div className="relative w-full h-72 bg-gray-100 rounded-md overflow-hidden">
            {cropSrc && (
              <Cropper
                image={cropSrc}
                crop={crop}
                zoom={zoom}
                aspect={effectiveAspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
              />
            )}
          </div>

          {/* Aspect-ratio presets (auto-detect mode) */}
          {autoDetectAspect && !aspect && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-600 whitespace-nowrap">Ratio</span>
              {RATIO_PRESETS.map((preset) => {
                const active = ratioOverride === preset.value;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setRatioOverride(preset.value)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Zoom slider */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600 whitespace-nowrap">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={isProcessing || !croppedPixels}
              className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            >
              {isProcessing ? 'Processing…' : 'Confirm'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default ImageCropperUpload;
