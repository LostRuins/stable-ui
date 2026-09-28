import { ref, watch, type Ref } from "vue";
import { db } from "@/utils/db";
import { releaseUrl, retainUrl, retainCachedUrl } from "@/utils/blobCache";

/** The caller owns one cache reference and must release it when finished. */
export async function acquireOutputBlobUrl(
    id: number,
    isCancelled: () => boolean = () => false,
): Promise<string | undefined> {
    if (isCancelled()) return;
    const cached = retainCachedUrl(id, "image");
    if (cached) return cached;
    const row = await db.outputs.get(id);
    if (!row || isCancelled()) return;
    return retainUrl(id, "image", row.image);
}

/** Lazily retain an output's primary image URL while it is rendered. */
export function useOutputBlobUrl(
    outputId: Readonly<Ref<number | undefined>>,
    enabled: Readonly<Ref<boolean>>,
): Readonly<Ref<string>> {
    const objectUrl = ref("");

    watch(
        [outputId, enabled],
        async ([id, isEnabled], _oldValues, onCleanup) => {
            objectUrl.value = "";
            if (id === undefined || !isEnabled) return;

            let retained = false;
            let cancelled = false;
            onCleanup(() => {
                cancelled = true;
                if (retained) releaseUrl(id, "image");
            });

            try {
                const nextUrl = await acquireOutputBlobUrl(id, () => cancelled);
                if (!nextUrl) return;
                retained = true;
                if (cancelled) {
                    releaseUrl(id, "image");
                    retained = false;
                    return;
                }
                objectUrl.value = nextUrl;
            } catch (error) {
                console.warn(`Failed to prepare output ${id} for display:`, error);
            }
        },
        { immediate: true },
    );

    return objectUrl;
}
