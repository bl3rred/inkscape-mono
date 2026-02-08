const express = require("express");
const { randomUUID } = require("crypto");
const ApiError = require("../errors/ApiError");
const Artwork = require("../models/Artwork");
const Tag = require("../models/Tag");
const Permission = require("../models/Permission");
const { upload } = require("../middleware/upload");
const { sendSuccess } = require("../utils/apiResponse");
const { deleteTempFile, hashFileSha256 } = require("../utils/fileProcessing");
const { computeImagePHash } = require("../utils/imageHash");
const { parsePermissionPayload } = require("../utils/permissionPayload");

const router = express.Router();

function normalizeUploadError(error) {
  if (!error || error.name !== "MulterError") {
    return error;
  }

  if (error.code === "LIMIT_FILE_SIZE") {
    return new ApiError(400, "UPLOAD_LIMIT_EXCEEDED", "File exceeds upload size limit of 25MB.");
  }

  if (error.code === "LIMIT_UNEXPECTED_FILE") {
    return new ApiError(400, "INVALID_UPLOAD", "Unexpected file field in upload request.");
  }

  return new ApiError(400, "INVALID_UPLOAD", error.message);
}

function singleUploadMiddleware(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (error) {
      return next(normalizeUploadError(error));
    }

    return next();
  });
}

function batchUploadMiddleware(req, res, next) {
  upload.array("files", 25)(req, res, (error) => {
    if (error) {
      return next(normalizeUploadError(error));
    }

    return next();
  });
}

async function createArtworkRecord(file, artistUserId, permissionPayload) {
  let artwork;
  let tag;

  try {
    const sha256Hash = await hashFileSha256(file.path);
    const perceptualHash = await computeImagePHash(file.path, {
      mimeType: file.mimetype,
      fileName: file.originalname
    });

    artwork = await Artwork.create({
      artist: artistUserId,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      sha256Hash,
      ...(perceptualHash ? { perceptualHash } : {})
    });

    tag = await Tag.create({
      artwork: artwork._id,
      artist: artistUserId,
      tagUuid: randomUUID(),
      status: "active"
    });

    const permission = await Permission.create({
      artwork: artwork._id,
      tag: tag._id,
      artist: artistUserId,
      version: 1,
      aiTrainingAllowed: permissionPayload.aiTrainingAllowed,
      allowedUseCases: permissionPayload.allowedUseCases,
      attributionRequired: permissionPayload.attributionRequired,
      notes: permissionPayload.notes,
      isActive: true
    });

    return {
      artworkId: String(artwork._id),
      tagId: String(tag._id),
      permissionId: String(permission._id),
      securityTag: tag.tagUuid,
      hash: artwork.sha256Hash,
      fileName: artwork.originalFilename,
      mimeType: artwork.mimeType,
      sizeBytes: artwork.sizeBytes,
      permissionVersion: permission.version
    };
  } catch (error) {
    if (tag) {
      await Tag.deleteOne({ _id: tag._id });
    }

    if (artwork) {
      await Artwork.deleteOne({ _id: artwork._id });
    }

    throw error;
  }
}

function formatArtistTag(artwork, tag, permission) {
  return {
    id: String(artwork._id),
    tag_id: tag ? tag.tagUuid : null,
    file_name: artwork.originalFilename,
    permissions: permission
      ? {
          ai_training: permission.aiTrainingAllowed,
          allowed_use_cases: permission.allowedUseCases || [],
          attribution: permission.attributionRequired || false,
          notes: permission.notes || ""
        }
      : { ai_training: "no", allowed_use_cases: [], attribution: false, notes: "" },
    created_at: artwork.createdAt,
    version: permission ? permission.version : null
  };
}

router.post("/artworks/upload", singleUploadMiddleware, async (req, res, next) => {
  const uploadedFile = req.file;

  try {
    if (!uploadedFile) {
      throw new ApiError(400, "FILE_REQUIRED", "file is required.");
    }

    const permissionPayload = parsePermissionPayload(req.body);
    const artwork = await createArtworkRecord(uploadedFile, req.user._id, permissionPayload);

    return sendSuccess(
      res,
      {
        artwork
      },
      201
    );
  } catch (error) {
    return next(error);
  } finally {
    await deleteTempFile(uploadedFile && uploadedFile.path);
  }
});

router.post("/artworks/upload-batch", batchUploadMiddleware, async (req, res, next) => {
  const uploadedFiles = Array.isArray(req.files) ? req.files : [];

  try {
    if (uploadedFiles.length === 0) {
      throw new ApiError(400, "FILES_REQUIRED", "At least one file is required in files field.");
    }

    const permissionPayload = parsePermissionPayload(req.body);
    const artworks = [];

    for (const file of uploadedFiles) {
      const artwork = await createArtworkRecord(file, req.user._id, permissionPayload);
      artworks.push(artwork);
      await deleteTempFile(file.path);
    }

    return sendSuccess(
      res,
      {
        count: artworks.length,
        artworks
      },
      201
    );
  } catch (error) {
    return next(error);
  } finally {
    for (const file of uploadedFiles) {
      await deleteTempFile(file.path);
    }
  }
});

router.get("/tags", async (req, res, next) => {
  try {
    const artworks = await Artwork.find({ artist: req.user._id }).sort({ createdAt: -1 }).lean();
    const artworkIds = artworks.map((a) => a._id);

    const tags = artworkIds.length > 0
      ? await Tag.find({ artwork: { $in: artworkIds }, status: "active" }).lean()
      : [];

    const permissions = artworkIds.length > 0
      ? await Permission.find({ artwork: { $in: artworkIds }, isActive: true }).sort({ artwork: 1, version: -1 }).lean()
      : [];

    const tagByArtwork = new Map(tags.map((t) => [String(t.artwork), t]));
    const permByArtwork = new Map();
    for (const p of permissions) {
      const key = String(p.artwork);
      if (!permByArtwork.has(key)) {
        permByArtwork.set(key, p);
      }
    }

    const result = artworks
      .filter((a) => tagByArtwork.has(String(a._id)))
      .map((a) => {
        const tag = tagByArtwork.get(String(a._id));
        const perm = permByArtwork.get(String(a._id));
        return formatArtistTag(a, tag, perm);
      });

    return sendSuccess(res, result);
  } catch (error) {
    return next(error);
  }
});

router.put("/tags/:tagId/permissions", async (req, res, next) => {
  try {
    const tagId = String(req.params.tagId || "").trim();
    if (!tagId) {
      throw new ApiError(400, "INVALID_TAG_ID", "tagId path parameter is required.");
    }

    const tag = await Tag.findOne({
      tagUuid: tagId,
      artist: req.user._id,
      status: "active"
    });

    if (!tag) {
      throw new ApiError(404, "TAG_NOT_FOUND", "Active tag not found for this artist.");
    }

    const permissionPayload = parsePermissionPayload(req.body || {});
    const latestPermission = await Permission.findOne({
      artwork: tag.artwork,
      tag: tag._id
    })
      .sort({ version: -1 })
      .lean();

    const nextVersion = latestPermission ? latestPermission.version + 1 : 1;

    await Permission.updateMany(
      {
        artwork: tag.artwork,
        tag: tag._id,
        isActive: true
      },
      {
        $set: {
          isActive: false
        }
      }
    );

    const permission = await Permission.create({
      artwork: tag.artwork,
      tag: tag._id,
      artist: req.user._id,
      version: nextVersion,
      aiTrainingAllowed: permissionPayload.aiTrainingAllowed,
      allowedUseCases: permissionPayload.allowedUseCases,
      attributionRequired: permissionPayload.attributionRequired,
      notes: permissionPayload.notes,
      isActive: true
    });

    const artwork = await Artwork.findById(tag.artwork).lean();
    if (!artwork) {
      throw new ApiError(404, "ARTWORK_NOT_FOUND", "Artwork for this tag no longer exists.");
    }

    return sendSuccess(res, formatArtistTag(artwork, tag, permission));
  } catch (error) {
    return next(error);
  }
});

router.delete("/tags/:tagId", async (req, res, next) => {
  try {
    const tagId = String(req.params.tagId || "").trim();
    if (!tagId) {
      throw new ApiError(400, "INVALID_TAG_ID", "tagId path parameter is required.");
    }

    const tag = await Tag.findOne({
      tagUuid: tagId,
      artist: req.user._id,
      status: "active"
    });

    if (!tag) {
      throw new ApiError(404, "TAG_NOT_FOUND", "Active tag not found for this artist.");
    }

    tag.status = "revoked";
    await tag.save();

    await Permission.updateMany(
      {
        tag: tag._id,
        artwork: tag.artwork,
        isActive: true
      },
      {
        $set: {
          isActive: false
        }
      }
    );

    return sendSuccess(res, {
      tag_id: tag.tagUuid,
      status: tag.status
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
