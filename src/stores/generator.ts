import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { useOutputStore, type ImageData } from "./outputs";
import { useUIStore } from "./ui";
import { useOptionsStore } from "./options";
import router from "@/router";
import { fabric } from "fabric";
import { useCanvasStore } from "./canvas";
import { useLocalStorage } from "@vueuse/core";
import { DEBUG_MODE, MAX_PARALLEL_REQUESTS } from "@/constants";
import { validateResponse } from "@/utils/validate";
function getDefaultStore() {
    return {
        steps: 25,
        n: 1,
        sampler_name: "Euler",
        width: 512,  // make sure these are divisible by 64
        height: 512, // make sure these are divisible by 64
        cfg_scale: 6,
        clip_skip: 0,
        seed: -1,
        denoising_strength: 0.6,
    }
}

export interface IModelData {
    title?: string;
    model_name?: string;
    hash?: string;
    sha256?: string;
    filename?: string;
    config?: null;
}

export type ICurrentGeneration = {
    images: string[];
    gathered: boolean;
    failed: boolean;
    params?: any;
}

interface ITypeParams {
    sourceProcessing?: "inpainting" | "img2img" | "outpainting";
    sourceImage?: string;
    maskImage?: string;
}

interface IPromptHistory {
    starred: boolean;
    prompt: string;
    timestamp: number;
}

type IMultiSelectItem<T> = {
    name: string;
    enabled: boolean;
    noneMessage: string;
    selected: T[];
    mapToParam: (data: ImageData) => any;
}

interface IMultiSelect {
    sampler: IMultiSelectItem<string>;
    steps: IMultiSelectItem<number>;
    guidance: IMultiSelectItem<number>;
    clipSkip: IMultiSelectItem<number>;
}

interface CarouselOutput {
    type: "image" | "video";
    index: number;
    output: ImageData;
}

export const useGeneratorStore = defineStore("generator", () => {
    const validGeneratorTypes = ['Text2Img', 'Img2Img', 'Inpainting'];
    const sourceGeneratorTypes = ['Img2Img', 'Inpainting'];
    const generatorType = ref<'Text2Img' | 'Img2Img' | 'Inpainting' | 'Rating' | 'Interrogation'>("Text2Img");

    const prompt = ref("");
    const promptHistory = useLocalStorage<IPromptHistory[]>("promptHistory", []);
    const negativePrompt = ref("");
    const negativePromptLibrary = useLocalStorage<string[]>("negativeLibrary", []);
    const params = ref(getDefaultStore());
    const timer = ref({
        interval: 0 as number | NodeJS.Timeout,
        seconds: 0 as number,
    });
    const multiSelect = ref<IMultiSelect>({
        sampler: {
            name: "Sampler",
            enabled: false,
            selected: ["Euler"],
            noneMessage: "Failed to generate: No sampler selected.",
            mapToParam: el => el.sampler_name,
        },
        steps: {
            name: "Steps",
            enabled: false,
            selected: [30],
            noneMessage: "Failed to generate: No steps selected.",
            mapToParam: el => el.steps,
        },
        guidance: {
            name: "CFG Scale",
            enabled: false,
            selected: [7],
            noneMessage: "Failed to generate: No guidance selected.",
            mapToParam: el => el.cfg_scale,
        },
        clipSkip: {
            name: "Clip Skip",
            enabled: false,
            selected: [1],
            noneMessage: "Failed to generate: No CLIP Skip selected.",
            mapToParam: el => el.clip_skip,
        },
    });

    const getDefaultImageProps = (): ITypeParams => ({
        sourceProcessing: undefined,
        sourceImage: undefined,
        maskImage: undefined,
    })

    const inpainting = ref<ITypeParams>({
        ...getDefaultImageProps(),
        sourceProcessing: "inpainting",
    })

    const img2img = ref(<ITypeParams>{
        ...getDefaultImageProps(),
        sourceProcessing: "img2img",
    })

    const getImageProps = (type: typeof generatorType.value): ITypeParams => {
        if (type === "Inpainting") {
            return inpainting.value;
        }
        if (type === "Img2Img") {
            return img2img.value;
        }
        return getDefaultImageProps();
    }

    const currentImageProps = computed(() => getImageProps(generatorType.value));

    const uploadDimensions = ref("");

    const generating = ref(false);
    const cancelled  = ref(false);
    const outputs    = ref<CarouselOutput[]>([]);
    const queue = ref<ICurrentGeneration[]>([]);

    const minDimensions = ref(64);
    const maxDimensions = computed(() => useOptionsStore().allowLargerParams === "Enabled" ? 3072 : 1536);
    const minImages = ref(1);
    const maxImages = ref(20);
    const minSteps = ref(1);
    const maxSteps = computed(() => useOptionsStore().allowLargerParams === "Enabled" ? 500 : 50);
    const minCfgScale = ref(1);
    const maxCfgScale = ref(24);
    const minDenoise = ref(0.1);
    const maxDenoise = ref(1);
    const minClipSkip = ref(0);
    const maxClipSkip = ref(10);

    const arrayRange = (start: number, end: number, step: number) => Array.from({length: (end - start + 1) / step}, (_, i) => (i + start) * step);
    const clipSkipList = ref(arrayRange(minClipSkip.value, maxClipSkip.value, 1));
    const cfgList =      ref(arrayRange(minCfgScale.value, maxCfgScale.value, 0.5));

    const totalImageCount = computed(() => {
        const multiCalc = (before: number, multiParam: IMultiSelectItem<any>, defaultMultiplier = 1) => before * (multiParam.enabled ? multiParam.selected.length : defaultMultiplier);
        const imageCount = params.value.n;
        const promptMatrixCount  = imageCount * promptMatrix().length;
        const multiSamplerCount  = multiCalc(promptMatrixCount,    multiSelect.value.sampler);
        const multiStepsCount    = multiCalc(multiSamplerCount,  multiSelect.value.steps);
        const multiGuidanceCount = multiCalc(multiStepsCount,    multiSelect.value.guidance);
        const multiClipSkipCount = multiCalc(multiGuidanceCount, multiSelect.value.clipSkip);
        return multiClipSkipCount;
    })

    /**
     * Resets the generator store to its default state
     * */
    function resetStore()  {
        params.value = getDefaultStore();
        inpainting.value = getDefaultImageProps();
        img2img.value = getDefaultImageProps();
        outputs.value = [];
        useUIStore().showGeneratedImages = false;
        clearQueue();
        return true;
    }

    function clearQueue()
    {
        queue.value = [];
    }

    /**
     * Generates images on the Horde; returns a list of image(s)
     * */
    async function generateImage(type: typeof generatorType["value"]) {
        if (!validGeneratorTypes.includes(type)) return [];

        if (prompt.value === "") return generationFailed("Failed to generate: No prompt submitted.");
        for (const multi of Object.values(multiSelect.value)) {
            if (multi.enabled && multi.selected.length === 0) return generationFailed(multi.noneMessage);
        }

        const canvasStore = useCanvasStore();
        const uiStore = useUIStore();

        canvasStore.saveImages();
        const { sourceImage, maskImage, sourceProcessing } = getImageProps(type);

        pushToPromptHistory(prompt.value);

        // Cache parameters so the user can't mutate the output data while it's generating
        const paramsCached: any[] = [];

        const getMultiSelect = <T>(item: IMultiSelectItem<T>, defaultValue: any): T[] => item.enabled ? item.selected : defaultValue;
        const prompts      = promptMatrix();
        const guidances    = getMultiSelect(multiSelect.value.guidance,    [params.value.cfg_scale]);
        const steps        = getMultiSelect(multiSelect.value.steps,       [params.value.steps]);
        const clipSkips    = getMultiSelect(multiSelect.value.clipSkip,    [params.value.clip_skip]);
        const samplers     = getMultiSelect(multiSelect.value.sampler,     [params.value.sampler_name]);

        const models = [ await updateAvailableModels() ];
        for (const currentGuidance of guidances) {
            for (const currentSteps of steps) {
                for (const currentClipSkip of clipSkips) {
                for (const currentPrompt of prompts) {
                    const p = currentPrompt.split(" ### ");
                    for (const currentSampler of (
                        samplers
                    )) {
                        for (let i = 0; i < params.value.n; i++) {
                            let origseed:number = parseInt((params.value.seed).toString());
                            if(origseed>0)
                            {
                                origseed += parseInt(i.toString());
                            }
                            let newgen:any = {
                                prompt: currentPrompt,
                                params: {
                                    ...params.value,
                                    seed: origseed,
                                    sampler_name: currentSampler,
                                    cfg_scale: currentGuidance,
                                    steps: currentSteps,
                                    clip_skip: currentClipSkip,
                                    prompt: p[0],
                                    negative_prompt: p[1] || "",
                                    init_images: sourceImage ? [ sourceImage.split(",")[1] ] : [],
                                    mask: maskImage,
                                    inpainting_mask_invert: (maskImage?0:null),
                                    inpainting_fill: (maskImage?1:null)
                                },
                                source_image: sourceImage?.split(",")[1],
                                source_mask: maskImage,
                                source_processing: sourceProcessing,
                                models: models
                            };
                            if(referenceBase64Images && referenceBase64Images.length>0)
                            {
                                newgen.params["extra_images"] = referenceBase64Images;
                            }
                            paramsCached.push(newgen);
                        }
                    }
                }}
            }
        }

        if (DEBUG_MODE) console.log("Using generation parameters:", paramsCached)

        generating.value = true;
        uiStore.showGeneratedImages = false;

        // Push each item in the parameters array to the queue
        for (let i = 0; i < paramsCached.length; i++) {
            queue.value.push({
                ...paramsCached[i],
                jobId: "",
                index: i,
                gathered: false,
                failed: false,
            })
        }

        // Reset variables
        outputs.value = [];
        cancelled.value = false;

        function getMaxRequests(arr: any[]) {
            return Math.min(arr.length, MAX_PARALLEL_REQUESTS);
        }

        if (timer.value.interval) {
            clearInterval(timer.value.interval);
            timer.value.interval = 0;
            timer.value.seconds = 0;
        }
        timer.value.interval = setInterval(() => {
            timer.value.seconds++;
        }, 1000);

        // Loop until queue is done or generation is cancelled
        while (!queue.value.every(el => el.gathered || el.failed) && !cancelled.value) {
            const availableQueue = queue.value.filter(el => !el.gathered && !el.failed);
            const maxRequests = getMaxRequests(availableQueue);

            for (const [i, queuedImage] of availableQueue.slice(0, maxRequests).entries()) {
                if (cancelled.value) break;
                queuedImage.gathered = true;
                try {
                    const finalImages = await fetchNewID(queuedImage.params);
                    if (!finalImages) {
                        queuedImage.failed = true;
                        continue;
                    }
                    processImages([{...finalImages, ...queuedImage}]);
                } catch (error) {
                    queuedImage.failed = true;
                    // Optionally handle the error here
                    console.error('Error fetching image:', error);
                }
            }
        }

        if (DEBUG_MODE) console.log("Images queued");
    }

    /**
     * Called when a generation is finished.
     * */
    async function processImages(finalImages: any[]) {
        const store = useOutputStore();

        console.log(finalImages)
        const finalParams: ImageData[] = await Promise.all(
            finalImages.map(async (image) => {
                const img = image.images[0];
                return {
                    // The database automatically increments IDs for us
                    id: -1,
                    image: `data:image/png;base64,${img}`,
                    prompt: image.prompt,
                    clip_skip: image.params.clip_skip,
                    modelName: image.models[0],
                    seed: image.params.seed,
                    steps: image.params.steps,
                    sampler_name: image.params.sampler_name,
                    cfg_scale: image.params.cfg_scale,
                    width: image.params.width,
                    height: image.params.height,
                }
            })
        )

        const newOutputs = await store.pushOutputs(finalParams) as ImageData[];

        // The index should the same for each of these outputs
        const index = 0;

        outputs.value = [
            ...newOutputs.map(el => ({
                type: "image",
                index,
                output: el,
            } as CarouselOutput)),
            ...outputs.value,
        ].sort((a,b) => a.index - b.index);

        if (outputs.value.length === queue.value.length) {
            queue.value = [];
            generating.value = false;
            useUIStore().showGeneratedImages = true;
            clearInterval(timer.value.interval);
            timer.value.interval = 0;
            timer.value.seconds = 0;
        }

        return finalParams;
    }

        /**
     * Called when an image has failed.
     * @returns []
     */
    async function generationFailed(error?: string) {
        const store = useUIStore();
        if (error) store.raiseError(error, false);
        return [];
    }

    function validateParam(paramName: string, param: number, max: number, defaultValue: number) {
        if (param <= max) return param;
        useUIStore().raiseWarning(`This image was generated using the 'Larger Values' option. Setting '${paramName}' to its default value instead of ${param}.`, true)
        return defaultValue;
    }

    /**
     * Prepare an image for going through text2img on the Horde
     * */
    function generateText2Img(data: ImageData, correctDimensions = true) {
        const defaults = getDefaultStore();
        generatorType.value = "Text2Img";
        multiSelect.value.guidance.enabled = false;
        multiSelect.value.sampler.enabled  = false;
        router.push("/");
        if (correctDimensions) {
            data.width = data.width || defaults.width as number;
            data.height = data.height || defaults.height as number;
        }
        if (data.prompt) {
            const splitPrompt = data.prompt.split(" ### ");
            prompt.value = splitPrompt[0];
            negativePrompt.value = splitPrompt[1] || "";
        }
        if (data.sampler_name)    params.value.sampler_name = data.sampler_name;
        if (data.steps)           params.value.steps = validateParam("steps", data.steps, maxSteps.value, defaults.steps as number);
        if (data.cfg_scale)       params.value.cfg_scale = data.cfg_scale;
        if (data.width)           params.value.width = validateParam("width", data.width, maxDimensions.value, defaults.width as number);
        if (data.height)          params.value.height = validateParam("height", data.height, maxDimensions.value, defaults.height as number);
        if (data.seed)            params.value.seed = data.seed;
        if (data.clip_skip)       params.value.clip_skip = validateParam("clip_skip", data.clip_skip, maxClipSkip.value, defaults.clip_skip as number);
    }

    /**
     * Prepare an image for going through img2img on the Horde
     * */
    function generateImg2Img(sourceimg: string) {
        const canvasStore = useCanvasStore();
        generatorType.value = "Img2Img";
        img2img.value.sourceImage = sourceimg;
        canvasStore.drawing = false;
        outputs.value = [];
        router.push("/");
        fabric.Image.fromURL(sourceimg, canvasStore.newImage);
    }

    /**
     * Prepare an image for going through inpainting on the Horde
     * */
    function generateInpainting(sourceimg: string) {
        const canvasStore = useCanvasStore();
        outputs.value = [];
        inpainting.value.sourceImage = sourceimg;
        generatorType.value = "Inpainting";
        router.push("/");
        fabric.Image.fromURL(sourceimg, canvasStore.newImage);
    }

    /**
     * Combines positive and negative prompt
     */
    function getFullPrompt() {
        if (negativePrompt.value === "") return prompt.value;
        return `${prompt.value} ### ${negativePrompt.value}`;
    }

    /**
     * Returns all prompt matrix combinations
     */
    function promptMatrix() {
        const prompt = getFullPrompt();
        const matrixMatches = prompt.match(/\{(.*?)\}/g) || [];
        if (matrixMatches.length === 0) return [prompt];
        let prompts: string[] = [];
        matrixMatches.forEach(matrix => {
            const newPrompts: string[] = [];
            const options = matrix.replace("{", "").replace("}", "").split("|");
            if (prompts.length === 0) {
                options.forEach(option => {
                    const newPrompt = prompt.replace(matrix, option);
                    newPrompts.push(newPrompt);
                });
            } else {
                prompts.forEach(previousPrompt => {
                    options.forEach(option => {
                        const newPrompt = previousPrompt.replace(matrix, option);
                        newPrompts.push(newPrompt);
                    });
                });
            }
            prompts = [...newPrompts];
        });
        return prompts;
    }

    /**
     * Fetches a new ID
     */
    async function fetchNewID(parameters: any) {
        const optionsStore = useOptionsStore();
        try {
            const response: Response = await fetch(`${optionsStore.baseURL.length === 0 ? "." : optionsStore.baseURL}/sdapi/v1/${parameters.init_images.length > 0 ? 'img' : 'txt'}2img`, {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(parameters)
            })
            const resJSON = await response.json();
            if (!validateResponse(response, resJSON, 200, "Failed to fetch", onInvalidResponse)) return false;
            return resJSON;
        } catch (e) {
            return false;
        }
    }

    function onInvalidResponse(msg: string) {
        const uiStore = useUIStore();
        uiStore.raiseError(msg, false);
        cancelled.value = false;
        outputs.value = [];
        return false;
    }

    /**
     * Updates available models
     * */
    async function updateAvailableModels() {
        const optionsStore = useOptionsStore();
        const response = await fetch(`${optionsStore.baseURL.length === 0 ? "." : optionsStore.baseURL}/sdapi/v1/sd-models`);
        const resJSON: any[] = await response.json();
        if (!validateResponse(response, resJSON, 200, "Failed to get available models")) return;
        if (resJSON.length === 0) return "(No model loaded)";
        return resJSON[0].model_name;
    }

    function pushToNegativeLibrary(prompt: string) {
        if (negativePromptLibrary.value.indexOf(prompt) !== -1) return;
        negativePromptLibrary.value = [...negativePromptLibrary.value, prompt];
    }

    function removeFromNegativeLibrary(prompt: string) {
        negativePromptLibrary.value = negativePromptLibrary.value.filter(el => el != prompt);
    }

    function pushToPromptHistory(prompt: string) {
        if (promptHistory.value.findIndex(el => el.prompt === prompt) !== -1) return;
        if (promptHistory.value.length >= 10 + promptHistory.value.filter(el => el.starred).length) {
            const unstarredHistory = promptHistory.value.filter(el => !el.starred);
            const lastUnstarredIndex = promptHistory.value.findIndex(el => el === unstarredHistory[unstarredHistory.length - 1]);
            promptHistory.value.splice(lastUnstarredIndex, 1);
        }
        promptHistory.value = [
            ...promptHistory.value,
            {
                starred: false,
                timestamp: Date.now(),
                prompt,
            }
        ];
    }

    function removeFromPromptHistory(prompt: string) {
        //@ts-ignore
        promptHistory.value = promptHistory.value.filter(el => el.prompt != prompt && el != prompt);
    }

    /**
     * Generates a prompt (either creates a random one or extends the current prompt)
     * */
    function getPrompt()  {
        return false;
    }

    var referenceBase64Images: string[] = []; //i hate vue so im gonna do this in vanilla js
    function setExtraImage(event:any)
    {
        let input = event.target;
        referenceBase64Images = [];
        if (input.files.length > 0) {
            for(let i=0;i<input.files.length;++i)
            {
                let selectedFile = input.files[i];
                const reader = new FileReader();
                reader.onload = function (e) {
                    let refimg = e.target?e.target.result as string:"";
                    if(refimg.includes("data:image"))
                    {
                        refimg = refimg.split(',')[1];
                    }
                    console.log(refimg);
                    referenceBase64Images.push(refimg);
                };
                reader.onerror = function () {
                    console.log("Error reading file.");
                };
                reader.readAsDataURL(selectedFile);
            }
        } else {
            console.log("No file to load")
        }
    };
    function clearExtraImage() {
        referenceBase64Images = [];
        const inputElement = document.getElementById('extra_image_input') as HTMLInputElement;
        if (inputElement) {
            inputElement.value = "";
        }
    }

    return {
        // Variables
        generatorType,
        prompt,
        params,
        outputs,
        inpainting,
        img2img,
        uploadDimensions,
        cancelled,
        multiSelect,
        negativePrompt,
        generating,
        negativePromptLibrary,
        minDimensions,
        maxDimensions,
        minImages,
        maxImages,
        minSteps,
        maxSteps,
        minCfgScale,
        maxCfgScale,
        minDenoise,
        maxDenoise,
        minClipSkip,
        maxClipSkip,
        clipSkipList,
        cfgList,
        queue,
        promptHistory,
        timer,
        // Constants
        validGeneratorTypes,
        sourceGeneratorTypes,
        // Computed
        currentImageProps,
        totalImageCount,
        // Actions
        generateImage,
        generateText2Img,
        generateImg2Img,
        generateInpainting,
        getPrompt,
        resetStore,
        clearQueue,
        pushToNegativeLibrary,
        removeFromNegativeLibrary,
        pushToPromptHistory,
        removeFromPromptHistory,
        setExtraImage,
        clearExtraImage,
    };
});
