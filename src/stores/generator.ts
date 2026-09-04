import { computed, ref, watch } from "vue";
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
import { extractLorasFromPrompt } from "@/utils/loras";
import { parsePromptSegments, expandPromptSegments } from "@/utils/expansions";
import { convertToBase64 } from "@/utils/base64";
import { buildApiUrl } from "@/utils/api";
function getDefaultStore() {
    return {
        steps: 20,
        n: 1,
        sampler_name: "Euler",
        width: 512,  // make sure these are divisible by 64
        height: 512, // make sure these are divisible by 64
        cfg_scale: 5,
        eta: 1.0,
        flow_shift: 0,
        clip_skip: 0,
        seed: -1,
        denoising_strength: 0.6,
        frames: 1,
        fps: 16,
        enable_hr: false,
        send_as_refimg: true,
        scheduler: "default",
    }
}

export function getNewSeed() {
    return Math.floor(Math.random() * 9999999) + 1; //keep seeds under 10m for peace of mind, some platforms may use f32 which has a max precision of 16m
}

function getNewGenkey() {
    return Math.floor(Math.random() * 900000 + 100000).toString();
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
    state: "Disabled" | "Enabled" | "Multiple";
    allowedStates?: ('Disabled' | 'Enabled' | 'Multiple')[];
    selected: T[];
    mapToParam: (data: ImageData) => any;
}

type IReferenceImage = {
    id: string;
    name: string;
    size: number;
    dataUrl: string;
    base64: string;
}

/**
 * A row of the non-persisted LoRA list on the generation screen
 * */
type ILoraListItem = {
    /** Selected LoRA (the `path` from GET /sdapi/v1/loras, empty until one is picked) */
    lora: string;
    /** LoRA multiplier, sent in the lora field of the generation parameters */
    multiplier: number;
}

interface IMultiSelect {
    sampler: IMultiSelectItem<string>;
    steps: IMultiSelectItem<number>;
    scheduler: IMultiSelectItem<string>;
    guidance: IMultiSelectItem<number>;
    clipSkip: IMultiSelectItem<number>;
    eta: IMultiSelectItem<number>;
    flowShift: IMultiSelectItem<number>;
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
    const progressInfo = ref<{
        percentage: number;
        textInfo: string | null;
        currentStep: number;
        totalSteps: number;
        previewImage: string | null;
    } | null>(null);
    const progressInterval = ref<number | NodeJS.Timeout>(0);
    const multiSelect = ref<IMultiSelect>({
        sampler: {
            name: "Sampler",
            state: "Enabled",
            allowedStates: ["Disabled", "Enabled", "Multiple"],
            selected: [params.value.sampler_name],
            mapToParam: el => el.sampler_name,
        },
        scheduler: {
            name: "Scheduler",
            state: "Enabled",
            allowedStates: ["Disabled", "Enabled", "Multiple"],
            selected: [params.value.scheduler],
            mapToParam: el => el.scheduler,
        },
        steps: {
            name: "Steps",
            state: "Enabled",
            allowedStates: ["Disabled", "Enabled", "Multiple"],
            selected: [params.value.steps],
            mapToParam: el => el.steps,
        },
        guidance: {
            name: "CFG Scale",
            state: "Enabled",
            allowedStates: ["Disabled", "Enabled", "Multiple"],
            selected: [params.value.cfg_scale],
            mapToParam: el => el.cfg_scale,
        },
        clipSkip: {
            name: "Clip Skip",
            state: "Disabled",
            allowedStates: ["Disabled", "Enabled", "Multiple"],
            selected: [params.value.clip_skip],
            mapToParam: el => el.clip_skip,
        },
        eta: {
            name: "Eta",
            state: "Disabled",
            allowedStates: ["Disabled", "Enabled"],
            selected: [params.value.eta],
            mapToParam: el => el.eta,
        },
        flowShift: {
            name: "Flow Shift",
            state: "Disabled",
            allowedStates: ["Disabled", "Enabled"],
            selected: [params.value.flow_shift],
            mapToParam: el => el.flow_shift,
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
    const abortController = ref<AbortController | null>(null);
    const queue = ref<ICurrentGeneration[]>([]);
    const lastImageGenkey = useLocalStorage("lastImageGenkey", "");
    const lastImageRecoveryUrl = computed(() => {
        if (!lastImageGenkey.value) return "";
        return buildApiUrl(useOptionsStore().baseURL, `/sdapi/v1/get_last.png?genkey=${encodeURIComponent(lastImageGenkey.value)}`);
    });
    const lastImageRecoveryAvailable = computed(() => lastImageRecoveryUrl.value !== "" && !generating.value);

    function clearLastImageGenkey() {
        lastImageGenkey.value = "";
    }

    function openLastImageRecovery() {
        if (!lastImageRecoveryUrl.value) return;
        window.open(lastImageRecoveryUrl.value, "_blank", "noopener");
        clearLastImageGenkey();
    }

    const minDimensions = ref(64);
    const maxDimensions = computed(() => useOptionsStore().allowLargerParams === "Enabled" ? 3072 : 1024);
    const minImages = ref(1);
    const maxImages = ref(20);
    const minSteps = ref(1);
    const maxSteps = computed(() => useOptionsStore().allowLargerParams === "Enabled" ? 150 : 50);
    const minCfgScale = ref(1);
    const maxCfgScale = ref(24);
    const minEta = ref(0);
    const maxEta = ref(1);
    const minFlowShift = ref(0);
    const maxFlowShift = ref(20);
    const minDenoise = ref(0);
    const maxDenoise = ref(1);
    const minClipSkip = ref(0);
    const maxClipSkip = ref(10);
    const minFrames = ref(1);
    const maxFrames = computed(() => useOptionsStore().allowLargerParams === "Enabled" ? 400 : 200);
    const minFps = ref(16);
    const maxFps = computed(() => useOptionsStore().allowLargerParams === "Enabled" ? 32 : 24);

    const arrayRange = (start: number, end: number, step: number) => Array.from({length: (end - start + 1) / step}, (_, i) => (i + start) * step);
    const clipSkipList = ref(arrayRange(minClipSkip.value, maxClipSkip.value, 1));
    const cfgList =      ref(arrayRange(minCfgScale.value, maxCfgScale.value, 0.5));

    const totalImageCount = computed(() => {
        const multiCalc = (before: number, multiParam: IMultiSelectItem<any>, defaultMultiplier = 1) => before * (multiParam.state === "Multiple" && multiParam.selected.length > 0 ? multiParam.selected.length : defaultMultiplier);
        const imageCount = params.value.n;
        const promptMatrixCount  = imageCount * promptMatrix().length;
        const multiSamplerCount   = multiCalc(promptMatrixCount,   multiSelect.value.sampler);
        const multiSchedulerCount = multiCalc(multiSamplerCount,   multiSelect.value.scheduler);
        const multiStepsCount     = multiCalc(multiSchedulerCount, multiSelect.value.steps);
        const multiGuidanceCount  = multiCalc(multiStepsCount,     multiSelect.value.guidance);
        const multiClipSkipCount  = multiCalc(multiGuidanceCount,  multiSelect.value.clipSkip);
        return multiClipSkipCount;
    })

    /**
     * Resets the generator store to its default state
     * */
    function resetStore()  {
        params.value = getDefaultStore();
        inpainting.value = getDefaultImageProps();
        img2img.value = getDefaultImageProps();
        videoStartFrame.value = null;
        videoEndFrame.value = null;
        outputs.value = [];
        loraList.value = [];
        useUIStore().showGeneratedImages = false;
        clearQueue();
        clearLastImageGenkey();
        return true;
    }

    function clearQueue()
    {
        queue.value = [];
    }
    function clearOutputs()
    {
        outputs.value = [];
    }

    /**
     * Fetches available LoRAs from the server. The result is cached per server
     * baseURL (see getCachedEndpoint), so repeated calls (the generation screen's
     * lazy panel fetch and generateImage) share a single round-trip. Resolves to
     * the list (which may be empty), or to null if the request failed (a failed
     * fetch is not cached, so the next attempt retries)
     * */
    async function fetchLoras(): Promise<any[] | null> {
        const result = await getCachedEndpoint<any[]>("/sdapi/v1/loras");
        return Array.isArray(result) ? result : null;
    }

    /**
     * Generates images on the Horde; returns a list of image(s)
     * */
    async function generateImage(type: typeof generatorType["value"]) {
        if (!validGeneratorTypes.includes(type)) return [];

        if (prompt.value === "") return generationFailed("Failed to generate: No prompt submitted.");

        const canvasStore = useCanvasStore();
        const uiStore = useUIStore();

        canvasStore.saveImages();
        const { sourceImage, maskImage, sourceProcessing } = getImageProps(type);

        pushToPromptHistory(prompt.value);

        // Cache parameters so the user can't mutate the output data while it's generating
        const paramsCached: any[] = [];

        // split "###" and {|} syntax; the negative prompt is never scanned for LoRA tags, so any
        // tag inside it is inert and is sent and stored as-is
        const processedRawPrompts = promptMatrix().map(ps => {
            const p = ps.split(" ### ");
            return {
                prompt: p[0],
                negative_prompt: p[1] || ""
            };
        });

        // extract <lora:name:value> from the positive prompt
        const promptsAndLoras = processedRawPrompts.map(ps => {
            const [cleanedPrompt, extractedLoras] = extractLorasFromPrompt(ps.prompt);
            return { ...ps, prompt: cleanedPrompt, extractedLoras: extractedLoras };
        });

        const availableLoras = (
            promptsAndLoras.some(ps => ps.extractedLoras.length > 0)
                || loraList.value.some(row => row.lora && row.lora.trim() !== "")
                ? (await fetchLoras() ?? []) : []);

        // the raw LoRA entries from the (non-persisted) LoRA list on the generation screen; rows
        // without a selected LoRA are ignored. The entry's name is the LoRA's display name when the
        // row can be resolved, the row's raw value otherwise (preserved as an inert tag)
        const loraListEntries = loraList.value
            .filter(row => row.lora && row.lora.trim() !== "")
            .flatMap(row => {
                const match = availableLoras.find(al => al.name === row.lora || al.path === row.lora);
                const multiplier = Number(row.multiplier);
                return [{
                    name: match ? match.name : row.lora,
                    multiplier: isNaN(multiplier) ? 0 : multiplier,
                    allowUnresolved: false,
                }];
            });

        // merge entries by (name, is_high_noise), accumulating the multipliers (the server accumulates
        // the same way for duplicate entries); entries with different is_high_noise are kept separate,
        // as they apply to different generation phases
        const mergeLoraEntries = (entries: { name: string; multiplier: number; is_high_noise?: boolean; allowUnresolved: boolean }[]) => {
            const merged = new Map<string, { name: string; multiplier: number; is_high_noise?: boolean; allowUnresolved: boolean }>();
            for (const entry of entries) {
                if (!entry.name || entry.name.trim() === "") continue;
                const key = `${entry.name}\u0000${entry.is_high_noise ? 1 : 0}`;
                const existing = merged.get(key);
                if (existing) {
                    existing.multiplier = Math.round((existing.multiplier + entry.multiplier) * 10000) / 10000;
                    existing.allowUnresolved = existing.allowUnresolved || entry.allowUnresolved;
                } else {
                    merged.set(key, { ...entry });
                }
            }
            return [...merged.values()];
        };

        const processedPrompts = promptsAndLoras.map(({ extractedLoras, ...ps }) => {
            // R: the raw LoRA list (the prompt's tags first, then the screen's rows) — everything that
            // was requested, including zero-multiplier and unresolvable entries, which are preserved
            // as inert <lora:> tags in the image metadata, but not sent to the server
            const rawLoraEntries = mergeLoraEntries([
                ...extractedLoras.map(l => ({
                    name: l.name,
                    multiplier: l.multiplier,
                    ...(l.is_high_noise ? { is_high_noise: true } : {}),
                    allowUnresolved: true,
                })),
                ...loraListEntries,
            ]);

            // G: what is actually sent to the server — zero-multiplier and unresolvable entries are
            // filtered out, and each name is resolved to the LoRA's path; two names resolving to the
            // same path are both sent (the server accumulates duplicate paths)
            const loraRequest = rawLoraEntries.flatMap(entry => {
                if (entry.multiplier === 0) return [];
                const match = availableLoras.find(al => al.name === entry.name || al.path === entry.name);
                const path = match ? match.path : entry.allowUnresolved ? entry.name : "";
                return path ? [{
                    path,
                    multiplier: entry.multiplier,
                    ...(entry.is_high_noise ? { is_high_noise: true } : {}),
                }] : [];
            });

            // the full prompt stored in the image metadata: the tag-free positive prompt with the raw
            // LoRA list R appended as <lora:> tags (so a re-queued image re-requests the same LoRAs),
            // then the untouched negative prompt. Space runs left behind by tag removal are collapsed
            // (metadata only, the request prompt is unaffected), so the stored prompt stays clean and
            // stable across re-queue/regeneration cycles
            const loraTags = rawLoraEntries.map(e =>
                `<lora:${e.is_high_noise ? "|high_noise|" : ""}${e.name}:${String(Math.round(e.multiplier * 10000) / 10000)}>`);
            const cleanedPositive = loraTags.length > 0 ? ps.prompt.replace(/ +/g, " ").trim() : ps.prompt;
            const taggedPrompt = [cleanedPositive, loraTags.join(" ")]
                .filter(s => s !== "")
                .join(" ");
            const full_prompt = ps.negative_prompt !== "" ? `${taggedPrompt} ### ${ps.negative_prompt}` : taggedPrompt;

            return {
                ...ps,
                full_prompt,
                ...(loraRequest.length > 0 ? { lora: loraRequest } : {})
            };
        });

        const { seed, cfg_scale, eta, steps, clip_skip, flow_shift, sampler_name, scheduler, n: batch_size,
            ...currentParams } = params.value;

        // create list of seeds
        const reqseed  = parseInt(seed.toString());
        const origseed = isNaN(reqseed) || reqseed < 0 ? getNewSeed() : reqseed;
        const seeds    = Array.from({ length: batch_size }, (_, i) => origseed + i);

        const getMultiSelect = <T>(item: IMultiSelectItem<T>, fallback: T): T[] => {
            if (item.state === "Disabled") return [];
            if (item.state === "Enabled") return [fallback]; // single-select: always use live params
            if (item.state === "Multiple" && item.selected.length === 0) return [];
            return item.selected; // "Multiple" with selections: use the multi-select list
        };

        const multiParams = {
            promptVariant: processedPrompts,
            seed:          seeds,
            cfg_scale:     getMultiSelect(multiSelect.value.guidance,  cfg_scale),
            eta:           getMultiSelect(multiSelect.value.eta,       eta),
            steps:         getMultiSelect(multiSelect.value.steps,     steps),
            clip_skip:     getMultiSelect(multiSelect.value.clipSkip,  clip_skip),
            sampler_name:  getMultiSelect(multiSelect.value.sampler,   sampler_name),
            scheduler:     getMultiSelect(multiSelect.value.scheduler, scheduler),
        };

        // given: {'a': [1, 2, 3], 'b':[4, 5], 'c':[]}
        // returns: [{'a':1,'b':4},{'a':1,'b':5},{'a':2,'b':4},{'a':2,'b':5},{'a':3,'b':4},{'a':3,'b':5}]
        const cartesianProduct = <T>(input: Record<string, any[]>): Record<string, any>[] => {
            const entries = Object.entries(input).filter(([_, values]) => values.length > 0);
            // will return the initial value [{}] if entries is empty
            return entries.reduce<Record<string, T>[]>((acc, [key, values]) => {
                const newAcc: Record<string, T>[] = [];
                for (const currentObj of acc) {
                    for (const value of values) {
                        newAcc.push({ ...currentObj, [key]: value });
                    }
                }
                return newAcc;
            }, [{}]);
        }

        const combinations = cartesianProduct(multiParams);
        if (DEBUG_MODE) console.log("multi parameters:", multiParams)
        if (DEBUG_MODE) console.log("combos:", combinations)

        const models = [ await updateAvailableModels() ];
        for (const combo of combinations) {
            const { promptVariant: { full_prompt, ...promptParams }, ...comboParams } = combo;
            const sendAsRefimg = type === "Img2Img" ? currentParams.send_as_refimg : false;
            const newgen:any = {
                prompt: full_prompt,
                params: {
                    ...currentParams,
                    send_as_refimg: sendAsRefimg,
                    ...comboParams,
                    ...promptParams,
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
            //don't send any default or unwanted params
            if(newgen.params["sampler_name"]=="default")
            {
                delete newgen.params["sampler_name"];
            }
            if(newgen.params["scheduler"]=="default")
            {
                delete newgen.params["scheduler"];
            }
            if(!newgen.params["frames"] || newgen.params["frames"]<=1)
            {
                delete newgen.params["frames"];
                delete newgen.params["fps"];
            }
            else
            {
                newgen.params["fps"] = Math.min(maxFps.value, Math.max(minFps.value, Math.round(Number(newgen.params["fps"]) || getDefaultStore().fps)));
            }
            const allowReferenceImages = type === "Text2Img";
            const referenceBase64Images = allowReferenceImages ? referenceImages.value.map(image => image.base64) : [];
            if(referenceBase64Images.length>0)
            {
                newgen.params["extra_images"] = referenceBase64Images;
            }
            if(allowReferenceImages && newgen.params["frames"] && newgen.params["frames"]>1)
            {
                if(videoStartFrame.value) newgen.params["video_start_frame"] = videoStartFrame.value.base64;
                if(videoEndFrame.value) newgen.params["video_end_frame"] = videoEndFrame.value.base64;
            }
            if(useOptionsStore().alsoRequestAvi === "Enabled" && newgen.params["frames"] && newgen.params["frames"]>1)
            {
                newgen.params["video_output_type"] = 2; //request avi to download as well
            }
            const kcppExtraArgs: any = {};
            if(multiSelect.value.flowShift.state === "Enabled" && flow_shift > 0)
            {
                kcppExtraArgs["params"] = {
                    flow_shift: flow_shift
                };
            }
            if(useOptionsStore().keepImageGenOnDisconnect === "Enabled")
            {
                kcppExtraArgs["keep_image_gen_on_disconnect"] = true;
            }
            if (Object.keys(kcppExtraArgs).length > 0)
            {
                newgen.params["kcpp_extra_args"] = kcppExtraArgs;
            }
            paramsCached.push(newgen);
        }

        if (DEBUG_MODE) console.log("Using generation parameters:", paramsCached)

        let is_new_generation = false;
        if(!generating.value)
        {
            is_new_generation = true;
            outputs.value = [];
        }
        generating.value = true;
        uiStore.showGeneratedImages = false;

        // Push each item in the parameters array to the queue
        const pendingQueue = queue.value.filter(el => !el.gathered && !el.failed); //number of incomplete reqs
        let reqLimCounter = pendingQueue.length;
        for (let i = 0; i < paramsCached.length; i++) {
            if(reqLimCounter < MAX_PARALLEL_REQUESTS)
            {
                queue.value.push({
                    ...paramsCached[i],
                    jobId: "",
                    index: i,
                    gathered: false,
                    failed: false,
                });
                ++reqLimCounter;
            }
        }

        if(!is_new_generation)
        {
            return;
        }

        // Reset variables
        abortController.value = new AbortController();
        cancelled.value = false;

        if (timer.value.interval) {
            clearInterval(timer.value.interval);
            timer.value.interval = 0;
            timer.value.seconds = 0;
        }
        timer.value.interval = setInterval(() => {
            timer.value.seconds++;
        }, 1000);
        startProgressPolling();

        // Loop until queue is done or generation is cancelled
        while (!queue.value.every(el => el.gathered || el.failed) && !cancelled.value) {
            const next = queue.value.find(
                q => !q.gathered && !q.failed
            );
            if (!next) break;
            next.gathered = true;
            try {
                const res = await fetchNewID(next.params, abortController.value?.signal);
                if (!res) {
                    next.failed = true;
                    continue;
                }
                processImages([{ ...res, ...next }]);
            } catch (error) {
                next.failed = true;
                console.error('Error fetching image:', error);
            }
        }
        if (queue.value.some(el => el.failed) && queue.value.every(el => el.gathered || el.failed)) {
            generating.value = false;
            clearInterval(timer.value.interval);
            timer.value.interval = 0;
            timer.value.seconds = 0;
            stopProgressPolling();
            queue.value = [];
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
                const animated = image.animated?true:false;
                const mime = (animated?'gif':'png');
                const extra_avi = (image.extra_data?(`data:video/avi;base64,${image.extra_data}`):"");
                const final_frame = (image.final_frame?`data:image/jpeg;base64,${image.final_frame}`:"");
                const params: any = {
                    // The database automatically increments IDs for us
                    id: -1,
                    image: `data:image/${mime};base64,${img}`,
                    prompt: image.prompt,
                    modelName: image.models[0],
                    frames: image.params.frames,
                    fps: image.params.fps,
                    extra_avi: extra_avi,
                    final_frame: final_frame,
                    enable_hr: image.params.enable_hr,
                    send_as_refimg: image.params.send_as_refimg,
                    // flow_shift is sent nested under kcpp_extra_args.params (not a top-level field)
                    flow_shift: image.params.kcpp_extra_args?.params?.flow_shift,
                    lora_meta: "",
                }
                if (image.info && typeof image.info === 'string' && image.info.trim() !== '') {
                    try {
                        const info = JSON.parse(image.info);
                        const directFields = ['seed', 'steps', 'sampler_name', 'cfg_scale', 'eta', 'width', 'height', 'clip_skip', 'fps'];
                        directFields.forEach(field => {
                            if (info[field] != undefined && info[field] != null) {
                                params[field] = info[field];
                            } else if (image.params[field] != undefined) {
                                params[field] = image.params[field];
                            }
                        });

                        // fields which need special mapping
                        if (info['extra_generation_params'] && info.extra_generation_params['Schedule type']) {
                            params.scheduler = info.extra_generation_params['Schedule type'];
                        } else {
                            params.scheduler = image.params.scheduler;
                        }
                        if (info['lora_meta']) {
                            params.lora_meta = info['lora_meta'];
                        }
                    } catch (e) {
                        console.warn('Failed to parse info JSON:', e);
                    }
                }
                return params;
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
            clearLastImageGenkey();
            clearInterval(timer.value.interval);
            timer.value.interval = 0;
            timer.value.seconds = 0;
            stopProgressPolling();
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
    async function generateText2Img(data: ImageData, correctDimensions = true) {
        const defaults = getDefaultStore();
        generatorType.value = "Text2Img";
        multiSelect.value.guidance.state  = "Enabled";
        multiSelect.value.sampler.state   = "Enabled";
        multiSelect.value.steps.state     = "Enabled";
        multiSelect.value.clipSkip.state  = "Disabled";
        multiSelect.value.scheduler.state = "Enabled";
        router.push("/");
        if (correctDimensions) {
            data.width = data.width || defaults.width as number;
            data.height = data.height || defaults.height as number;
        }
        if (data.prompt) {
            const splitPrompt = data.prompt.split(" ### ");
            prompt.value = splitPrompt[0];
            negativePrompt.value = splitPrompt[1] || "";
            // the restored prompt carries the stored <lora:> tags; remove any matching row of the
            // non-persisted LoRA list, so regenerating doesn't apply the row's multiplier on top of
            // the tag it was stored from
            const [, restoredLoras] = extractLorasFromPrompt(prompt.value);
            if (restoredLoras.length > 0) {
                const availableLoras = (await fetchLoras()) ?? [];
                loraList.value = loraList.value.filter(row => {
                    if (!row.lora || row.lora.trim() === "") return true;
                    return !restoredLoras.some(tag =>
                        tag.name === row.lora
                        || availableLoras.some(al => al.name === tag.name && al.path === row.lora));
                });
            }
        }
        if (data.sampler_name) {
            params.value.sampler_name = data.sampler_name;
            // see if it is an alias instead of the main name
            const samplers = await getAvailableSamplers();
            const sampler = samplers.find((s: any) => (s.aliases && s.aliases.includes(data.sampler_name)));
            if (sampler) {
                params.value.sampler_name = sampler.name;
            }
        }
        if (data.steps)           params.value.steps = validateParam("steps", data.steps, maxSteps.value, defaults.steps as number);
        if (data.cfg_scale)       params.value.cfg_scale = data.cfg_scale;
        if (data.eta || data.eta === 0) params.value.eta = data.eta;
        if (data.flow_shift || data.flow_shift === 0) {
            params.value.flow_shift = data.flow_shift;
            multiSelect.value.flowShift.state = data.flow_shift > 0 ? "Enabled" : "Disabled";
        }
        if (data.width)           params.value.width = validateParam("width", data.width, maxDimensions.value, defaults.width as number);
        if (data.height)          params.value.height = validateParam("height", data.height, maxDimensions.value, defaults.height as number);
        if (data.seed)            params.value.seed = data.seed;
        if (data.clip_skip)       params.value.clip_skip = validateParam("clip_skip", data.clip_skip, maxClipSkip.value, defaults.clip_skip as number);
        if (data.scheduler)       params.value.scheduler = data.scheduler;
        if (data.frames)          params.value.frames = validateParam("frames", data.frames, maxFrames.value, defaults.frames as number);
        if (data.fps)             params.value.fps = Math.min(maxFps.value, Math.max(minFps.value, Math.round(validateParam("fps", data.fps, maxFps.value, defaults.fps as number))));
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
     * Returns all prompt matrix combinations. Expansion is two-phase: the
     * prompt is parsed into literal/expansion segments (an expansion ends at
     * the first `}`, no nesting; a stray or unclosed brace is literal), then
     * the segments are expanded via Cartesian product and concatenated — no
     * string replacement, so options are used verbatim.
     */
    function promptMatrix() {
        const prompt = getFullPrompt();
        return expandPromptSegments(parsePromptSegments(prompt));
    }

    /**
     * Fetches a new ID
     */
    async function fetchNewID(parameters: any, signal?: AbortSignal) {
        const optionsStore = useOptionsStore();
        try {
            const genkey = getNewGenkey();
            lastImageGenkey.value = genkey;
            const requestParameters = {
                ...parameters,
                genkey,
            };
            const response: Response = await fetch(buildApiUrl(optionsStore.baseURL, `/sdapi/v1/${parameters.init_images.length > 0 ? 'img' : 'txt'}2img`), {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestParameters),
                signal
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
        const response = await fetch(buildApiUrl(optionsStore.baseURL, "/sdapi/v1/sd-models"));
        const resJSON: any[] = await response.json();
        if (!validateResponse(response, resJSON, 200, "Failed to get available models")) return;
        if (resJSON.length === 0) return "(No model loaded)";
        return resJSON[0].model_name;
    }

    // Cache variables
    const cacheVersion = ref(0);
    const cacheMap = new Map<string, Promise<any>>();

    function invalidateApiCaches() {
        cacheMap.clear();
        cacheVersion.value++;
    }

    // Watch baseURL and clear cache if it changes
    watch(
        () => useOptionsStore().baseURL,
        () => {
            invalidateApiCaches();
        }
    );

    // fetch endpoint information and keep a cache of the result
    async function getCachedEndpoint<T>(endpoint: string): Promise<T | null> {
        const optionsStore = useOptionsStore();
        const fullUrl = buildApiUrl(optionsStore.baseURL, endpoint);
        if (cacheMap.has(fullUrl)) {
            return cacheMap.get(fullUrl);
        }
        const fetchPromise = (async (): Promise<T | null> => {
            try {
                const response = await fetch(fullUrl);
                if (response.ok) {
                    return (await response.json()) as T;
                }
                console.error(`API Error: ${response.status} ${response.statusText} at ${fullUrl}`);
            } catch (error) {
                console.error(`Fetch error for ${fullUrl}:`, error);
            }
            cacheMap.delete(fullUrl);
            return null;
        })();
        cacheMap.set(fullUrl, fetchPromise);
        return fetchPromise;
    }

    async function getAvailableSamplers(): Promise<any[]> {
        const result = await getCachedEndpoint<any[]>("/sdapi/v1/samplers");
        return Array.isArray(result) ? result : [];
    }

    async function getAvailableSchedulers(): Promise<any[]> {
        const result = await getCachedEndpoint<any[]>("/sdapi/v1/schedulers");
        return Array.isArray(result) ? result : [];
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

    // --- Non-persisted LoRA list (name + multiplier pairs) on the generation screen ---
    const loraList = ref<ILoraListItem[]>([]);

    function addLoraRow() {
        loraList.value = [...loraList.value, { lora: "", multiplier: 0 }];
    }

    function removeLoraRow(index: number) {
        loraList.value = loraList.value.filter((_, i) => i !== index);
    }

    const referenceImages = ref<IReferenceImage[]>([]);

    const videoStartFrame = ref<IReferenceImage | null>(null);
    const videoEndFrame = ref<IReferenceImage | null>(null);

    async function getImageFromEvent(event: any): Promise<IReferenceImage | null> {
        const input = event.target as HTMLInputElement;
        const fileList = input.files ?? event.dataTransfer?.files;
        const selectedFile = (Array.from(fileList ?? []) as File[])[0];

        if (!selectedFile) {
            return null;
        }

        const dataUrl = await convertToBase64(selectedFile) as string;
        return {
            id: `${Date.now()}-${selectedFile.name}`,
            name: selectedFile.name,
            size: selectedFile.size,
            dataUrl,
            base64: dataUrl.includes("data:image") ? dataUrl.split(',')[1] : dataUrl,
        };
    }

    async function setVideoStartFrame(event: any) {
        videoStartFrame.value = await getImageFromEvent(event);
        const input = event.target as HTMLInputElement;
        if (input.value !== undefined) {
            input.value = "";
        }
    }

    async function setVideoEndFrame(event: any) {
        videoEndFrame.value = await getImageFromEvent(event);
        const input = event.target as HTMLInputElement;
        if (input.value !== undefined) {
            input.value = "";
        }
    }

    function clearVideoStartFrame() {
        videoStartFrame.value = null;
        const inputElement = document.getElementById('video_start_frame_input') as HTMLInputElement;
        if (inputElement) {
            inputElement.value = "";
        }
    }

    function clearVideoEndFrame() {
        videoEndFrame.value = null;
        const inputElement = document.getElementById('video_end_frame_input') as HTMLInputElement;
        if (inputElement) {
            inputElement.value = "";
        }
    }

    async function setExtraImage(event:any) {
        const input = event.target as HTMLInputElement;
        const fileList = input.files ?? event.dataTransfer?.files;
        const files = Array.from(fileList ?? []) as File[];

        if (files.length === 0) {
            return;
        }

        const images = await Promise.all(files.map(async (selectedFile, index) => {
            const dataUrl = await convertToBase64(selectedFile) as string;
            return {
                id: `${Date.now()}-${index}-${selectedFile.name}`,
                name: selectedFile.name,
                size: selectedFile.size,
                dataUrl,
                base64: dataUrl.includes("data:image") ? dataUrl.split(',')[1] : dataUrl,
            };
        }));

        if(!referenceImages.value)
        {
            referenceImages.value = [];
        }
        for(let i=0;i<images.length;++i)
        {
            referenceImages.value.push(images[i]);
        }
        if (input.value !== undefined) {
            input.value = "";
        }
    }

    function removeExtraImage(index: number) {
        referenceImages.value.splice(index, 1);
    }

    function moveExtraImage(index: number, direction: -1 | 1) {
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= referenceImages.value.length) return;

        const images = [...referenceImages.value];
        const [image] = images.splice(index, 1);
        images.splice(nextIndex, 0, image);
        referenceImages.value = images;
    }

    function clearExtraImage() {
        referenceImages.value = [];
        const inputElement = document.getElementById('extra_image_input') as HTMLInputElement;
        if (inputElement) {
            inputElement.value = "";
        }
    }

    // --- Progress polling ---
    const lastPreviewKey = ref("");
    const lastPreviewStep = ref(-1);

    async function fetchProgressInfo(): Promise<void> {
        const optionsStore = useOptionsStore();
        try {
            // lightweight poll for numbers
            const response = await fetch(buildApiUrl(optionsStore.baseURL, `/sdapi/v1/progress?skip_current_image=true&genkey=${encodeURIComponent(lastImageGenkey.value)}`));
            if (!response.ok) return;
            const data = await response.json();
            if (DEBUG_MODE) console.error('progressInfo:', data);

            progressInfo.value = {
                percentage: Math.round((data.progress ?? 0) * 100),
                textInfo: data.textinfo || null,
                currentStep: data.state?.sampling_step ?? 0,
                totalSteps: data.state?.sampling_steps ?? 0,
                previewImage: progressInfo.value?.previewImage ?? null
            };

            if (lastPreviewKey.value != lastImageGenkey.value) {
                lastPreviewKey.value = lastImageGenkey.value;
                lastPreviewStep.value = -1;
            }

            const currentStep = data.state?.sampling_step ?? 0;
            if (lastPreviewStep.value != currentStep) {
                lastPreviewStep.value = currentStep;
                // Only fetch preview image if set to "Image"
                if (optionsStore.fetchGenerationProgress === "Image") {
                    fetchPreviewImage();
                }
            }
        } catch {
            // progress endpoint may not be available
        }
    }

    async function fetchPreviewImage(): Promise<void> {
        const optionsStore = useOptionsStore();
        try {
            const response = await fetch(buildApiUrl(optionsStore.baseURL, `/sdapi/v1/progress?genkey=${encodeURIComponent(lastImageGenkey.value)}`));
            if (!response.ok) return;
            const data = await response.json();
            if (data.current_image && progressInfo.value) {
                progressInfo.value.previewImage = data.current_image;
            }
        } catch {
            // progress endpoint may not be available
        }
    }

    function startProgressPolling(): void {
        lastPreviewKey.value = '';
        if (progressInterval.value) return;
        // Skip polling if set to "Off"
        if (useOptionsStore().fetchGenerationProgress === "Off") return;
        progressInfo.value = { percentage: 0, textInfo: null, currentStep: 0, totalSteps: 0, previewImage: null };
        progressInterval.value = setInterval(fetchProgressInfo, 2000);
    }

    function stopProgressPolling(): void {
        if (progressInterval.value) {
            clearInterval(progressInterval.value);
            progressInterval.value = 0;
        }
        progressInfo.value = null;
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
        abortController,
        multiSelect,
        referenceImages,
        videoStartFrame,
        videoEndFrame,
        loraList,
        addLoraRow,
        removeLoraRow,
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
        minFrames,
        maxFrames,
        minFps,
        maxFps,
        minEta,
        maxEta,
        minFlowShift,
        maxFlowShift,
        clipSkipList,
        cfgList,
        queue,
        promptHistory,
        timer,
        progressInfo,
        progressInterval,
        lastImageGenkey,
        lastImageRecoveryUrl,
        lastImageRecoveryAvailable,
        clearLastImageGenkey,
        openLastImageRecovery,
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
        clearOutputs,
        stopProgressPolling,
        pushToNegativeLibrary,
        removeFromNegativeLibrary,
        pushToPromptHistory,
        removeFromPromptHistory,
        setExtraImage,
        removeExtraImage,
        moveExtraImage,
        clearExtraImage,
        setVideoStartFrame,
        setVideoEndFrame,
        clearVideoStartFrame,
        clearVideoEndFrame,
        getAvailableSamplers,
        getAvailableSchedulers,
        fetchLoras,
        cacheVersion,
        invalidateApiCaches,
        getCachedEndpoint
    };
});
