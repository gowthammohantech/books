const { body, validationResult } = require("express-validator");
const fs = require('fs');
const path = require('path');

exports.createSignatureValidator = [
    body("signatureName")
        .trim()
        .notEmpty()
        .withMessage("Signature name is required")
        .isLength({ min: 2 })
        .withMessage("Signature name must be at least 2 characters")
        .isLength({ max: 50 })
        .withMessage("Signature name cannot exceed 50 characters"),
        
    body("markAsDefault")
        .optional()
        .isBoolean()
        .withMessage("markAsDefault must be a boolean value"),

    (req, res, next) => {
        if (!req.file) {
            return res.status(422).json({
                message: 'Validation failed',
                errors: { signatureImage: 'Signature image is required' }
            });
        }

        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (!allowedTypes.includes(req.file.mimetype)) {
            fs.unlinkSync(req.file.path);
            return res.status(422).json({
                message: 'Validation failed',
                errors: { signatureImage: 'Only JPEG, PNG, and GIF images are allowed' }
            });
        }

        if (req.file.size > 2 * 1024 * 1024) {
            fs.unlinkSync(req.file.path);
            return res.status(422).json({
                message: 'Validation failed',
                errors: { signatureImage: 'Image size must be less than 2MB' }
            });
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            if (req.file && req.file.path) {
                fs.unlinkSync(req.file.path);
            }
            
            const formattedErrors = {};
            errors.array().forEach((err) => {
                if(!formattedErrors[err.path]){
                    formattedErrors[err.path] = err.msg;
                }
            });
            
            return res.status(422).json({ 
                message: 'Validation failed',
                errors: formattedErrors
            });
        }
        next();
    },
];

exports.updateSignatureValidator = [
    body("signatureName")
        .optional()
        .trim()
        .notEmpty()
        .withMessage("Signature name cannot be empty")
        .isLength({ min: 2 })
        .withMessage("Signature name must be at least 2 characters")
        .isLength({ max: 50 })
        .withMessage("Signature name cannot exceed 50 characters"),
        
    body("markAsDefault")
        .optional()
        .isBoolean()
        .withMessage("markAsDefault must be a boolean value"),
        
    body("status")
        .optional()
        .isBoolean()
        .withMessage("status must be a boolean value"),

    (req, res, next) => {
        // Only validate file if it's being uploaded
        if (req.file) {
            const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
            if (!allowedTypes.includes(req.file.mimetype)) {
                fs.unlinkSync(req.file.path);
                return res.status(422).json({
                    message: 'Validation failed',
                    errors: { signatureImage: 'Only JPEG, PNG, and GIF images are allowed' }
                });
            }

            if (req.file.size > 2 * 1024 * 1024) {
                fs.unlinkSync(req.file.path);
                return res.status(422).json({
                    message: 'Validation failed',
                    errors: { signatureImage: 'Image size must be less than 2MB' }
                });
            }
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            if (req.file?.path) {
                fs.unlinkSync(req.file.path);
            }
            
            const formattedErrors = {};
            errors.array().forEach((err) => {
                if(!formattedErrors[err.path]) {
                    formattedErrors[err.path] = err.msg;
                }
            });
            
            return res.status(422).json({ 
                message: 'Validation failed',
                errors: formattedErrors
            });
        }
        next();
    },
];