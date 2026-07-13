# Licences tierces — modèles IA et runtimes du pipeline IDV

Conformément aux licences Apache-2.0 / MIT, ce fichier conserve les notices
des modèles et bibliothèques embarqués pour la vérification d'identité
(docs/IDV-KYC.md). Chaque licence (code **et** poids) a été vérifiée à la
source avant intégration — règle projet du 13/07/2026.

## Modèles embarqués (`models/idv/`)

| Fichier                               | Modèle                       | Auteur / origine            | Licence    | Source vérifiée                                                                        |
| ------------------------------------- | ---------------------------- | --------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `face_detection_yunet_2023mar.onnx`   | YuNet (détection de visage)  | Shiqi Yu et al., OpenCV Zoo | MIT        | <https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE>   |
| `face_recognition_sface_2021dec.onnx` | SFace (embeddings de visage) | Zhong et al., OpenCV Zoo    | Apache-2.0 | <https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/LICENSE> |

Intégrité : SHA-256 épinglés dans `scripts/idv-fetch-models.mjs`.

À venir (étapes 5-6, mêmes exigences) : PP-OCR det/rec (PaddleOCR,
Apache-2.0), MiniFASNetV2 (Silent-Face-Anti-Spoofing, Apache-2.0, conversion
ONNX maison), tessdata (Apache-2.0).

## Runtimes serveur

| Paquet                         | Usage                            | Licence    |
| ------------------------------ | -------------------------------- | ---------- |
| `onnxruntime-node` (Microsoft) | Exécution des modèles ONNX (CPU) | MIT        |
| `sharp` (Lovell Fuller et al.) | Décodage / recadrage d'images    | Apache-2.0 |

## Côté client (étapes 4 et 6)

| Paquet                    | Usage                                                | Licence    |
| ------------------------- | ---------------------------------------------------- | ---------- |
| MediaPipe Tasks (Google)  | Guidage caméra + défis liveness (framework ET poids) | Apache-2.0 |
| `tesseract.js` + tessdata | Lecture MRZ (OCR-B)                                  | Apache-2.0 |

Les textes complets des licences Apache-2.0 et MIT sont disponibles dans les
dépôts sources référencés ci-dessus.
