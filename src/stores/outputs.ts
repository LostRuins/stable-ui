import { defineStore } from "pinia";
import { toRef, ref } from "vue";
import { useUIStore } from "./ui";
import { useOptionsStore } from "./options";
import { loadAsync } from 'jszip';
import { ElMessage, type UploadFile } from 'element-plus';
import { useLocalStorage } from "@vueuse/core";
import { db } from "@/utils/db";
import { liveQuery, type IndexableType } from "dexie";
import { from } from 'rxjs';
import { useObservable } from "@vueuse/rxjs";
import { useLiveQuery } from "@/utils/useLiveQuery";
import { evict } from "@/utils/blobCache";

export interface ImageData {
    id: number;
    image: string;
    prompt?: string;
    sampler_name?: string;
    seed?: number;
    steps?: number;
    cfg_scale?: number;
    height?: number;
    width?: number;
    modelName?: string;
    starred?: 1 | 0;
    clip_skip?: number;
    frames?: number;
    fps?: number;
    scheduler?: string;
    extra_avi?: string;
    final_frame?: string;
    enable_hr?: 1 | 0;
    send_as_refimg?: 1 | 0;
    eta?: number;
    flow_shift?: number;
    lora_meta?: string;
}

/**
 * A string-free view of an ImageData row, for reactively exposed state
 * (carousel outputs, gallery page, dialog).
 *
 * Carries every ImageData metadata field except image/extra_avi/final_frame.
 * Renderers acquire the image's blob URL lazily using the row id.
 * - hasAvi / hasFinalFrame: presence flags replacing the string fields
 *   (button visibility);
 * - type: carried from the generator's CarouselOutput (always "image"
 *   today); bare DB rows have no source, so the default is "image".
 *
 * INVARIANT: no object that lives in reactive state ever holds the
 * data-URL strings. Rows coming out of Dexie are mapped through
 * toViewModel immediately; the raw row becomes garbage after the map.
 */
export interface OutputViewModel {
    id: number;
    prompt?: string;
    sampler_name?: string;
    seed?: number;
    steps?: number;
    cfg_scale?: number;
    height?: number;
    width?: number;
    modelName?: string;
    starred?: 1 | 0;
    clip_skip?: number;
    frames?: number;
    fps?: number;
    scheduler?: string;
    enable_hr?: 1 | 0;
    send_as_refimg?: 1 | 0;
    eta?: number;
    flow_shift?: number;
    lora_meta?: string;
    // Not declared on the ImageData interface, but rows carry it at
    // runtime (it is a Dexie index; importFromZip writes it and the
    // "unrated" filter queries it) — comes through the `...rest` spread.
    rated?: number;
    hasAvi: boolean;
    hasFinalFrame: boolean;
    type: "image" | "video";
}

/**
 * Maps a full ImageData row to a string-free OutputViewModel. Blob creation is
 * deliberately deferred until a renderer mounts.
 */
export function toViewModel(row: ImageData, type: "image" | "video" = "image"): OutputViewModel {
    // Destructure the string fields OUT — the returned object must not hold
    // image/extra_avi/final_frame.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { image, extra_avi, final_frame, ...rest } = row;

    return {
        ...rest,
        hasAvi: extra_avi != null && extra_avi !== "",
        hasFinalFrame: final_frame != null && final_frame !== "",
        type,
    };
}

export const useOutputStore = defineStore("outputs", () => {
    const outputsLength = useObservable<number, number>(
        from(
            liveQuery(() => db.outputs.count())
        ),
        {
            initialValue: 0,
        },
    );
    const currentPage = ref(1);
    const sortBy = useLocalStorage<"Newest" | "Oldest">("sortOutputsBy", "Oldest");
    const currentLayout = useLocalStorage<"grid" | "dynamic">("currentImagesLayout", "dynamic");
    const filterBy = ref<"all" | "favourited" | "unfavourited" | 'unrated'>("all");
    const currentOutputs = useLiveQuery<OutputViewModel[], OutputViewModel[]>(
        () => {
            const store = useOptionsStore();

            let sortedOutputs;
            if (filterBy.value === "all") {
                sortedOutputs = db.outputs;
            } else if (filterBy.value === "favourited") {
                sortedOutputs = db.outputs.where("starred").equals(1);
            } else if (filterBy.value === "unfavourited") {
                sortedOutputs = db.outputs.where("starred").equals(0);
            } else {
                sortedOutputs = db.outputs.where("rated").equals(0);
            }

            if (sortBy.value === "Newest") {
                sortedOutputs = sortedOutputs.reverse();
            }

            const query = store.pageless === "Enabled"
                ? sortedOutputs
                : sortedOutputs
                    .offset((currentPage.value - 1) * store.pageSize)
                    .limit(store.pageSize);
            // Raw data-URL strings live only for this query's structured clone;
            // renderers acquire blob URLs lazily for mounted outputs.
            return query.toArray().then(rows => rows.map(row => toViewModel(row)));
        },
        [ toRef(useOptionsStore(), "pageless"), toRef(useOptionsStore(), "pageSize"), currentPage, sortBy, filterBy ],
        {
            initialValue: [],
        },
    );

    /**
     * Prevents user images from being cleared automatically by the browser
     */
    async function persistStorage() {
        if (navigator.storage && navigator.storage.persist) {
            const isPersisted = await navigator.storage.persist();
            console.log(`Persisted storage granted: ${isPersisted}`);
        }
    }

    async function recoverLocalStorageOutputs() {
        const outputsLocalStorage = localStorage.getItem("outputs");
        if (!outputsLocalStorage) return;
        pushOutputs(JSON.parse(outputsLocalStorage));
        localStorage.removeItem("outputs");
    }

    persistStorage();
    recoverLocalStorageOutputs();

    /**
     * Appends outputs
     * */
    async function pushOutputs(newOutputs: ImageData[]) {
        // The database auto increments the ID for us
        const newOutputsWithoutID = newOutputs.map(el => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id, ...rest } = el;
            return rest;
        })
        const chunkSize = 50;
        const allIds: IndexableType[] = [];
        for (let i = 0; i < newOutputsWithoutID.length; i += chunkSize) {
            const chunk = newOutputsWithoutID.slice(i, i + chunkSize);
            const cleanChunk = JSON.parse(JSON.stringify(chunk));
            console.log(`Inserting outputs into database. Chunk ${i} - ${i + chunkSize}:`, cleanChunk);
            const chunkIds = await db.outputs.bulkAdd(cleanChunk, undefined, { allKeys: true }) as IndexableType[];
            allIds.push(...chunkIds);
        }
        return db.outputs.bulkGet(allIds);
    }

    /**
     * Import images from a ZIP file
     */
    async function importFromZip(uploadFile: UploadFile) {
        const uiStore = useUIStore();

        if (!uploadFile.raw) return;
        if (!uploadFile.raw.type.includes("zip")) {
            uiStore.raiseError("Uploaded file needs to be a ZIP!", false);
            return;
        }
        const { files } = await loadAsync(uploadFile.raw);
        let outputsAppended = 0;
        let outputsFailed = 0;
        ElMessage({
            message: `Loading images...`,
            type: 'info',
        })
        const pushing = [];
        for (const [name, file] of Object.entries(files)) {
            const splitName = name.split(".");
            const fileType = splitName.slice(-1).join(".");
            const fileName = splitName.slice(0, -1).join(".");
            if (fileType === "webp" || fileType === "png" || fileType === "gif" || fileType === "jpg" || fileType === "jpeg") {
                // Async to speed up
                pushing.push(
                    new Promise(resolve => {
                        file.async("base64").then(async (webp) => {
                            if (!files[fileName+".json"]) {
                                outputsFailed++;
                                return resolve(null);
                            }
                            const json = JSON.parse(await files[fileName+".json"].async("text"));
                            outputsAppended++;
                            resolve({
                                id: -1,
                                image: `data:image/webp;base64,${webp}`,
                                ...json,
                                rated: json.rated ? 1 : 0,
                                starred: json.starred ? 1 : 0,
                            })
                        }).catch(err => {
                            uiStore.raiseError(`Error while importing image: ${err}`, false);
                            outputsFailed++;
                            return resolve(null);
                        });
                    })
                );
            }
        }
        const newImages = await Promise.all(pushing);
        pushOutputs(newImages.filter(image => image !== null) as ImageData[]);
        ElMessage({
            message: `Successfully imported ${outputsAppended}/${outputsAppended + outputsFailed} images!`,
            type: 'success',
        })
    }

    /**
     * Toggles whether or not an output corresponding to an ID is starred
     * */
    async function toggleStarred(id: number) {
        const output = await db.outputs.get(id);
        return db.outputs.update(id, {
            starred: output?.starred ? 0 : 1,
        });
    }

    /**
     * Deletes an output corresponding to an ID
     * */
    async function deleteOutput(id: number) {
        await db.outputs.delete(id);
        // THE ONLY eviction site: drop the row's cached blobs/URLs once the row is gone
        evict(id);
    }

    /**
     * Deletes multiples outputs corresponding to their IDs
     * */
    async function deleteMultipleOutputs(ids: number[]) {
        const uiStore = useUIStore();
        uiStore.selected = [];
        uiStore.multiSelect = false;
        await db.outputs.bulkDelete(ids);
        // Evict per id: delete-all is a plain bulkDelete of all ids (the former
        // db.outputs.clear() special case was dead code, removed separately)
        for (const id of ids) evict(id);
    }

    return {
        // Variables
        outputsLength,
        sortBy,
        filterBy,
        currentPage,
        currentOutputs,
        currentLayout,
        // Actions
        deleteOutput,
        deleteMultipleOutputs,
        toggleStarred,
        pushOutputs,
        importFromZip,
    };
});
