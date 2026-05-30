import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useGeneratorStore } from "./generator";
import { useOptionsStore } from "./options";
import { fabric } from "fabric";

export const useCanvasStore = defineStore("canvas", () => {
    interface ICanvasParams {
        canvas: fabric.Canvas | undefined;
        brush: fabric.BaseBrush | undefined;
        visibleImageLayer: fabric.Group | undefined;
        imageLayer: fabric.Canvas | undefined;
        visibleDrawLayer: fabric.Group | undefined;
        drawLayer: fabric.Canvas | undefined;
        cropPreviewLayer: fabric.Group | undefined;
        maskPathColor: string;
        maskBackgroundColor: string;
        imageScale: number;
        undoHistory: IHistory[];
        redoHistory: IHistory[];
        drawing: boolean;
    }

    const defaultCanvasParams = (): ICanvasParams => ({
        canvas: undefined,
        brush: undefined,
        visibleImageLayer: undefined,
        imageLayer: undefined,
        visibleDrawLayer: undefined,
        drawLayer: undefined,
        cropPreviewLayer: undefined,
        maskPathColor: "",
        maskBackgroundColor: "",
        imageScale: 1,
        undoHistory: [],
        redoHistory: [],
        drawing: false,
    })

    const inpainting = ref<ICanvasParams>({
        ...defaultCanvasParams(),
        maskPathColor: "white",
        maskBackgroundColor: "black",
    });

    const img2img = ref<ICanvasParams>({
        ...defaultCanvasParams(),
        maskPathColor: "black",
        maskBackgroundColor: "white",
    });

    const usingInpainting = computed(() => {
        const store = useGeneratorStore();
        return store.generatorType === "Inpainting";
    })

    const imageProps = computed(() => usingInpainting.value ? inpainting.value : img2img.value);
    const generatorImageProps = computed(() => useGeneratorStore().currentImageProps);

    const drawing = computed({
        get: () => imageProps.value.drawing && !usingInpainting.value,
        set: (value) => imageProps.value.drawing = value
    })

    const width = ref(512);
    const height = ref(512);
    const erasing = ref(false);
    const brushSize = ref(30);
    const showCropPreview = ref(false);
    const outlineLayer  = new fabric.Circle({
        radius: brushSize.value,
        left: 0,
        originX: "center",
        originY: "center",
        angle: 0,
        fill: "",
        stroke: "red",
        strokeWidth: 3,
        opacity: 0,
    });
    const switchToolText = ref("Erase");
    const drawColor = ref("rgb(0, 0, 0, 1)");

    interface IHistory {
        path: fabric.Path;
        drawPath?: fabric.Path;
        visibleDrawPath?: fabric.Path;
    }

    function updateCanvas() {
        if (!imageProps.value.canvas) return;
        imageProps.value.canvas.renderAll();
    }

    function flipErase() {
        erasing.value = !erasing.value;
        switchToolText.value = erasing.value ? "Draw" : "Erase";
    }

    function setBrush(color: string | null = null) {
        if (!imageProps.value.canvas) return;
        imageProps.value.brush = imageProps.value.canvas.freeDrawingBrush;
        imageProps.value.brush.color = color || imageProps.value.brush.color;
        imageProps.value.brush.width = brushSize.value;
    }

    interface pathCreateOptions {
        history?: IHistory;
        erase?: boolean;
        draw?: boolean;
    }

    async function pathCreate({history, erase = false, draw = false}: pathCreateOptions = {}) {
        if (!history) return;
        if (!imageProps.value.drawLayer) return;
        if (!imageProps.value.visibleDrawLayer) return;
        if (!imageProps.value.imageLayer) return;
        if (!imageProps.value.visibleImageLayer) return;
        if (!imageProps.value.canvas) return;

        history.path.selectable = false;
        history.path.opacity = 1;

        history.drawPath  = await asyncClone(history.path) as fabric.Path;
        history.visibleDrawPath = await asyncClone(history.path) as fabric.Path;

        if (erase) {
            history.visibleDrawPath.globalCompositeOperation = 'destination-out';
            history.drawPath.stroke = imageProps.value.maskBackgroundColor;
        } else {
            history.visibleDrawPath.globalCompositeOperation = 'source-over';
            history.drawPath.stroke = draw ? drawColor.value : imageProps.value.maskPathColor;
        }
        let scaledDrawPath = await asyncClone(history.drawPath) as fabric.Path;
        scaledDrawPath = scaledDrawPath.scale(imageProps.value.imageScale) as fabric.Path;
        scaledDrawPath.left = (scaledDrawPath.left as number) + (history.drawPath.left as number) * (imageProps.value.imageScale - 1);
        scaledDrawPath.top = (scaledDrawPath.top as number) + (history.drawPath.top as number) * (imageProps.value.imageScale - 1);
        if (draw) {
            imageProps.value.imageLayer.add(scaledDrawPath);
            imageProps.value.visibleImageLayer.addWithUpdate(history.visibleDrawPath);
        } else {
            imageProps.value.drawLayer.add(scaledDrawPath);
            imageProps.value.visibleDrawLayer.addWithUpdate(history.visibleDrawPath);
        }

        imageProps.value.canvas.remove(history.path);
        updateCanvas();
    }

    function redoAction() {
        if (imageProps.value.undoHistory.length === 0) return;
        const path = imageProps.value.undoHistory.pop() as IHistory;
        pathCreate({history: path, erase: false, draw: drawing.value});
        imageProps.value.redoHistory.push(path);
    }

    function undoAction() {
        if (imageProps.value.redoHistory.length === 0) return;
        if (!imageProps.value.drawLayer) return;
        if (!imageProps.value.visibleDrawLayer) return;
        if (!imageProps.value.imageLayer) return;
        if (!imageProps.value.visibleImageLayer) return;
        if (!imageProps.value.canvas) return;
        const path = imageProps.value.redoHistory.pop() as IHistory;
        imageProps.value.undoHistory.push(path);
        if (drawing.value) {
            imageProps.value.imageLayer.remove(path.drawPath as fabric.Path);
            imageProps.value.visibleImageLayer.remove(path.visibleDrawPath as fabric.Path);
        } else {
            imageProps.value.drawLayer.remove(path.drawPath as fabric.Path);
            imageProps.value.visibleDrawLayer.remove(path.visibleDrawPath as fabric.Path);
        }
        delete path.drawPath;
        delete path.visibleDrawPath;
        updateCanvas();
    }

    function createNewCanvas(canvasElement: string) {
        imageProps.value.canvas = new fabric.Canvas(canvasElement, {
            isDrawingMode: false,
            width: width.value,
            height: height.value,
            backgroundColor: "white"
        });
        imageProps.value.canvas.selection = false;
        imageProps.value.canvas.freeDrawingCursor = "crosshair";
        setBrush(imageProps.value.maskPathColor);
        imageProps.value.canvas.on("mouse:move", onMouseMove);
        imageProps.value.canvas.on("path:created", onPathCreated);
        updateCanvas();
    }

    function scaleImageTo(image: fabric.Image, widthAmount: number, heightAmount: number, minDimensions: number) {
        let newHeight = minDimensions;
        let newWidth = minDimensions;
        if (widthAmount > heightAmount) {
            image.scaleToWidth(minDimensions);
            newHeight = minDimensions * (height.value / width.value);
        } else {
            image.scaleToHeight(minDimensions);
            newWidth = minDimensions * (width.value / height.value);
        }
        return { newHeight, newWidth };
    }

    function newImage(image: fabric.Image) {
        const store = useGeneratorStore();
        resetCanvas();
        image.selectable = false;
        width.value = image.width as number;
        height.value = image.height as number;

        if (width.value > store.maxDimensions || height.value > store.maxDimensions) {
            const { newHeight, newWidth } = scaleImageTo(image, width.value, height.value, store.maxDimensions);
            width.value = newWidth;
            height.value = newHeight;
        }

        if (width.value < store.minDimensions || height.value < store.minDimensions) {
            const { newHeight, newWidth } = scaleImageTo(image, width.value, height.value, store.minDimensions);
            width.value = newWidth;
            height.value = newHeight;
        }

        const visibleDimensions = 512;
        const sourceLayerWidth = width.value;
        const sourceLayerHeight = height.value;
        imageProps.value.imageScale = Math.max(sourceLayerWidth, sourceLayerHeight) / visibleDimensions;

        image.cloneAsImage((clonedImage: fabric.Image) => {
            imageProps.value.imageLayer = makeInvisibleLayer({image: clonedImage, layerHeight: sourceLayerHeight, layerWidth: sourceLayerWidth});
        })

        image.cloneAsImage((clonedImage: fabric.Image) => {
            if (!imageProps.value.canvas) return;
            if (width.value !== visibleDimensions || height.value !== visibleDimensions) {
                const { newHeight, newWidth } = scaleImageTo(clonedImage, width.value, height.value, visibleDimensions);
                width.value = newWidth;
                height.value = newHeight;
            }
            imageProps.value.canvas.setWidth(width.value);
            imageProps.value.canvas.setHeight(height.value);
            imageProps.value.canvas.isDrawingMode = true;

            imageProps.value.visibleDrawLayer = makeNewLayer();
            imageProps.value.visibleImageLayer = makeNewLayer({image:clonedImage});
            imageProps.value.drawLayer = makeInvisibleLayer({layerHeight: sourceLayerHeight, layerWidth: sourceLayerWidth});
            const scaledWidth = width.value * imageProps.value.imageScale;
            const scaledHeight = height.value * imageProps.value.imageScale;
            store.params.width = scaledWidth - (scaledWidth % 64);
            store.params.height = scaledHeight - (scaledHeight % 64);
            imageProps.value.visibleDrawLayer.set("opacity", 0.8);
            imageProps.value.canvas.add(imageProps.value.visibleImageLayer);
            imageProps.value.canvas.add(imageProps.value.visibleDrawLayer);
            imageProps.value.canvas.add(outlineLayer);
            showCropPreview.value = true;
            updateCropPreview();
            saveImages();
        })
    }

    /**
     * Applies a transformation mode to a source canvas and returns a new canvas with the result.
     */
    function applyTransform(
        src: HTMLCanvasElement,
        targetWidth: number,
        targetHeight: number,
        bgColor: any,
        mode: string,
        reference?: HTMLCanvasElement
    ): HTMLCanvasElement {
        // use reference dimensions for crop/pad math if provided (keeps mask aligned to image)
        const refWidth  = reference ? reference.width  : src.width;
        const refHeight = reference ? reference.height : src.height;

        if (mode === "Original") {
            return src;
        }

        const dst = document.createElement('canvas');
        dst.width = targetWidth;
        dst.height = targetHeight;

        const ctx = dst.getContext('2d')!;
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, dst.width, dst.height);

        // Default source rectangle (entire source image)
        let sx = 0, sy = 0, sw = src.width, sh = src.height;
        // Default destination rectangle (entire target canvas)
        let dx = 0, dy = 0, dw = dst.width, dh = dst.height;

        switch (mode) {
            case "Stretch":
                // Defaults handle this: full source stretched to full target.
                break;
            case "ScaleAndCrop": {
                const wRatio = dst.width / refWidth;
                const hRatio = dst.height / refHeight;
                if (wRatio > hRatio) {
                    sh = dst.height / wRatio;
                    sy = (src.height - sh) / 2;
                } else {
                    sw = dst.width / hRatio;
                    sx = (src.width - sw) / 2;
                }
                break;
            }
            case "ScaleAndPad": {
                const wRatio = dst.width / refWidth;
                const hRatio = dst.height / refHeight;
                if (wRatio < hRatio) {
                    dh = refHeight * wRatio;
                    dy = (dst.height - dh) / 2;
                } else {
                    dw = refWidth * hRatio;
                    dx = (dst.width - dw) / 2;
                }
                break;
            }
            case "NoScale":
            default: {
                // No scaling. Handle independent cropping or padding per axis.
                const anchorX = refWidth  / 2;
                const anchorY = refHeight / 2;

                if (refWidth > targetWidth) {
                    sw = targetWidth;
                    sx = anchorX - targetWidth / 2;
                } else {
                    dw = refWidth;
                    dx = targetWidth / 2 - anchorX;
                }

                if (refHeight > targetHeight) {
                    sh = targetHeight;
                    sy = anchorY - targetHeight / 2;
                } else {
                    dh = refHeight;
                    dy = targetHeight / 2 - anchorY;
                }
                break;
            }
        }

        // Draw the calculated rectangle from source to destination
        ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);

        return dst;
    }

    function saveImages() {
        const store = useGeneratorStore();
        const optionsStore = useOptionsStore();
        if (!imageProps.value.imageLayer) return;
        if (!imageProps.value.drawLayer) return;

        const targetWidth  = store.params.width as number;
        const targetHeight = store.params.height as number;
        const bgColor      = (imageProps.value.imageLayer.backgroundColor) || '#FFFFFF';
        const resizeMode   = optionsStore.imageResizeMode;

        const srcImageCanvas  = imageProps.value.imageLayer.toCanvasElement();
        // const center = imageProps.value.imageLayer.getCenter();

        const destImageCanvas = applyTransform(srcImageCanvas, targetWidth, targetHeight, bgColor, resizeMode, srcImageCanvas);

        generatorImageProps.value.sourceImage = destImageCanvas.toDataURL('image/jpeg', 1.0);
        generatorImageProps.value.maskImage   = undefined;

        const includeMask = imageProps.value.redoHistory.length > 0 && !drawing.value;
        if (includeMask) {
            const srcMaskCanvas  = imageProps.value.drawLayer.toCanvasElement();
            const destMaskCanvas = applyTransform(srcMaskCanvas, targetWidth, targetHeight, bgColor, resizeMode, srcImageCanvas);

            generatorImageProps.value.maskImage = destMaskCanvas.toDataURL('image/jpeg', 1.0).split(",")[1];
        }
    }

    let timeout: undefined | NodeJS.Timeout;

    function updateCropPreview() {
        if (!imageProps.value.canvas) return;
        const store = useGeneratorStore();
        if (imageProps.value.cropPreviewLayer) {
            imageProps.value.canvas.remove(imageProps.value.cropPreviewLayer);
            imageProps.value.cropPreviewLayer = undefined;
        }
        if (!showCropPreview.value) return;
        imageProps.value.cropPreviewLayer = makeNewLayer({
            layerWidth: (store.params.width as number) / imageProps.value.imageScale,
            layerHeight: (store.params.height as number) / imageProps.value.imageScale,
            fill: "rgba(100, 0, 0, 0.5)"
        });
        imageProps.value.canvas.centerObject(imageProps.value.cropPreviewLayer);
        imageProps.value.canvas.add(imageProps.value.cropPreviewLayer);
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            showCropPreview.value = false;
            updateCropPreview();
            timeout = undefined;
        }, 5000)
    }

    interface ILayerParams {
        image?: fabric.Image;
        layerWidth?: number;
        layerHeight?: number;
        fill?: string;
        abosolute?: boolean;
    }

    function newBlankImage(height: number, width: number) {
        // Create a 1x1 white pixel and resize
        const whitePixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAA1JREFUGFdj+P///38ACfsD/QVDRcoAAAAASUVORK5CYII=';
        fabric.Image.fromURL(whitePixel, image => {
            image.set({ height, width });
            const imageBase64 = image.toDataURL({ format: "png" });
            generatorImageProps.value.sourceImage = imageBase64;
            drawing.value = true;
            newImage(image);
        })
    }

    function makeInvisibleLayer({image, layerWidth, layerHeight}: ILayerParams = {}) {
        const newLayer = new fabric.Canvas(null);
        newLayer.selection = false;
        newLayer.backgroundColor = imageProps.value.maskBackgroundColor;
        newLayer.setHeight(layerHeight || height.value);
        newLayer.setWidth(layerWidth || width.value);
        if (image) newLayer.add(image);
        return newLayer;
    }

    function imageLayerDimensions(): ILayerParams {
        if (!imageProps.value.imageLayer) return {};
        return {
            layerHeight: imageProps.value.imageLayer.getHeight(),
            layerWidth: imageProps.value.imageLayer.getWidth(),
        };
    }

    function makeNewLayer({image, layerWidth, layerHeight, fill, abosolute}: ILayerParams = {}) {
        const newLayer = image || new fabric.Rect({
            width: layerWidth || width.value,
            height: layerHeight || height.value,
            left: 0,
            top: 0,
            fill: fill || "transparent",
            absolutePositioned: abosolute || true,
            selectable: false,
        })

        const newGroup = new fabric.Group([newLayer], {
            selectable: false,
            absolutePositioned: abosolute || true,
        });

        return newGroup;
    }

    function resetCanvas() {
        if (!imageProps.value.canvas) return;
        if (imageProps.value.visibleImageLayer) {
            imageProps.value.canvas.remove(imageProps.value.visibleImageLayer);
            imageProps.value.visibleImageLayer = undefined;
        }
        if (imageProps.value.visibleDrawLayer) {
            imageProps.value.canvas.remove(imageProps.value.visibleDrawLayer);
            imageProps.value.visibleDrawLayer = undefined;
        }
        imageProps.value.imageLayer = undefined;
        imageProps.value.drawLayer = undefined;
        imageProps.value.redoHistory = [];
        imageProps.value.undoHistory = [];
        imageProps.value.canvas.isDrawingMode = false;
    }

    function resetDrawing() {
        if (!imageProps.value.canvas) return;
        if (imageProps.value.visibleDrawLayer) {
            imageProps.value.canvas.remove(imageProps.value.visibleDrawLayer);
            imageProps.value.visibleDrawLayer = undefined;
        }
        if (drawing.value) {
            const store = useGeneratorStore();
            newBlankImage(store.params.height || 512, store.params.width || 512);
        }
        imageProps.value.drawLayer = undefined;
        imageProps.value.redoHistory = [];
        imageProps.value.undoHistory = [];
        imageProps.value.visibleDrawLayer = makeNewLayer();
        imageProps.value.drawLayer = makeInvisibleLayer(imageLayerDimensions());
        imageProps.value.visibleDrawLayer.set("opacity", 0.8)
        imageProps.value.canvas.add(imageProps.value.visibleDrawLayer);
    }

    function downloadMask() {
        saveImages();
        const anchor = document.createElement("a");
        if (drawing.value) {
            anchor.href = 'data:image/png;base64,'+generatorImageProps.value.sourceImage?.split(",")[1];
            anchor.download = "image_drawing.png";
            anchor.click();
            return;
        }
        anchor.href = 'data:image/png;base64,'+generatorImageProps.value.maskImage;
        anchor.download = "image_mask.png";
        anchor.click();
    }

    async function asyncClone(object: any) {
        return new Promise((resolve, reject) => {
            try {
                object.clone(resolve);
            } catch (error) {
                reject(error);
            }
        });
    }

    async function onPathCreated(e: any) {
        const path: IHistory = { path: e.path }
        pathCreate({history: path, erase: erasing.value, draw: drawing.value});
        imageProps.value.redoHistory.push(path);
    }

    function onMouseMove(event: fabric.IEvent<Event>) {
        if (!imageProps.value.canvas) return;

        const pointer = imageProps.value.canvas.getPointer(event.e);
        outlineLayer.left = pointer.x;
        outlineLayer.top = pointer.y;
        outlineLayer.opacity = 0.8;

        if (erasing.value) {
            outlineLayer.set("strokeWidth", 3);
            outlineLayer.set("fill", "");
            setBrush("red");
        } else {
            outlineLayer.set("strokeWidth", 0);
            if (drawing.value) {
                outlineLayer.set("fill", drawColor.value);
                setBrush(drawColor.value);
            } else {
                outlineLayer.set("fill", "white");
                setBrush("white");
            }
        }
        outlineLayer.set("radius", brushSize.value / 2);
        updateCanvas();
    }

    return {
        // Variables
        showCropPreview,
        erasing,
        switchToolText,
        brushSize,
        drawColor,
        drawing,
        // Computed
        imageProps,
        // Actions
        updateCropPreview,
        createNewCanvas,
        downloadMask,
        resetCanvas,
        resetDrawing,
        flipErase,
        undoAction,
        redoAction,
        newImage,
        newBlankImage,
        setBrush,
        saveImages
    };
});
