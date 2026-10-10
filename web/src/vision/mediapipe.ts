// Lazily loads MediaPipe Tasks (served from our own server; see server/index.ts).
import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

let fileset: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
const wasm = () => (fileset ??= FilesetResolver.forVisionTasks('/mediapipe/wasm'));

async function withGpuFallback<T>(make: (delegate: 'GPU' | 'CPU') => Promise<T>): Promise<T> {
  try {
    return await make('GPU');
  } catch (e) {
    console.warn('[vision] GPU delegate failed, using CPU', e);
    return make('CPU');
  }
}

export function createFaceLandmarker(opts: { numFaces: number; mode: 'IMAGE' | 'VIDEO' }) {
  return withGpuFallback(async (delegate) =>
    FaceLandmarker.createFromOptions(await wasm(), {
      baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
      runningMode: opts.mode,
      numFaces: opts.numFaces,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
      minFaceDetectionConfidence: 0.4,
      minFacePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    }),
  );
}

export function createPoseLandmarker() {
  return withGpuFallback(async (delegate) =>
    PoseLandmarker.createFromOptions(await wasm(), {
      baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    }),
  );
}

export type { FaceLandmarker, PoseLandmarker };
