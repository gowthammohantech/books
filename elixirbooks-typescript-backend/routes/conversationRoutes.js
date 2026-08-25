const express = require('express');
const router = express.Router();
const protect = require('../middleware/authMiddleware');
const ConversationalAIController = require('../controllers/ConversationController');
const { prisma } = require('../lib/prisma');

router.post('/message', protect, async (req, res) => {
    try {
        const { message, sessionId } = req.body;
        // Tenant (company-owner) id so the AI assistant operates over the shared
        // workspace dataset — every admin can view/edit/delete its documents.
        // Falls back to the acting user only if tenant resolution was skipped.
        const userId = req.tenantId || req.user;

        if (!message) {
            return res.status(400).json({
                success: false,
                message: 'Message is required'
            });
        }

        console.log(`Processing conversation message for user ${userId}:`, message.substring(0, 50) + '...');

        const aiService = new ConversationalAIController(userId, sessionId);
        const response = await aiService.processMessage(message);

        res.status(200).json({
            success: true,
            ...response
        });
    } catch (error) {
        console.error('Conversation error:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing message',
            error: error.message
        });
    }
});

router.get('/history/:sessionId', protect, async (req, res) => {
    try {
        const { sessionId } = req.params;
        // Tenant (company-owner) id so the AI assistant operates over the shared
        // workspace dataset — every admin can view/edit/delete its documents.
        // Falls back to the acting user only if tenant resolution was skipped.
        const userId = req.tenantId || req.user;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID is required'
            });
        }

        const aiService = new ConversationalAIController(userId, sessionId);
        const history = await aiService.getConversationHistory();

        res.status(200).json({
            success: true,
            history
        });
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching history',
            error: error.message
        });
    }
});

router.post('/reset/:sessionId', protect, async (req, res) => {
    try {
        const { sessionId } = req.params;
        // Tenant (company-owner) id so the AI assistant operates over the shared
        // workspace dataset — every admin can view/edit/delete its documents.
        // Falls back to the acting user only if tenant resolution was skipped.
        const userId = req.tenantId || req.user;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID is required'
            });
        }

        const aiService = new ConversationalAIController(userId, sessionId);
        const newSessionId = await aiService.resetConversation();

        res.status(200).json({
            success: true,
            message: 'Conversation reset successfully',
            sessionId: newSessionId
        });
    } catch (error) {
        console.error('Error resetting conversation:', error);
        res.status(500).json({
            success: false,
            message: 'Error resetting conversation',
            error: error.message
        });
    }
});

// Get document for editing
router.get('/:type/:id', protect, async (req, res) => {
    try {
        const { type, id } = req.params;
        // Tenant (company-owner) id so the AI assistant operates over the shared
        // workspace dataset — every admin can view/edit/delete its documents.
        // Falls back to the acting user only if tenant resolution was skipped.
        const userId = req.tenantId || req.user;

        let document;
        // Scope all lookups by userId so cross-tenant access is impossible.
        switch (type) {
            case 'invoice':
                document = await prisma.invoice.findFirst({ where: { id, userId, isDeleted: false } });
                break;
            case 'quotation':
                document = await prisma.quotation.findFirst({ where: { id, userId, isDeleted: false } });
                break;
            case 'expense':
                document = await prisma.expense.findFirst({ where: { id, userId, isDeleted: false } });
                break;
            default:
                return res.status(400).json({ success: false, message: 'Invalid document type' });
        }

        if (!document) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }

        res.status(200).json({ success: true, data: document });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Soft delete document
router.delete('/:type/:id', protect, async (req, res) => {
    try {
        const { type, id } = req.params;
        // Tenant (company-owner) id so the AI assistant operates over the shared
        // workspace dataset — every admin can view/edit/delete its documents.
        // Falls back to the acting user only if tenant resolution was skipped.
        const userId = req.tenantId || req.user;

        let document;
        // Use updateMany scoped to userId so a cross-tenant soft-delete is
        // impossible (equivalent to Mongoose's findOneAndUpdate with userId
        // in the filter). updateMany returns a count; we then re-fetch the
        // record to return the same shape as the previous implementation.
        switch (type) {
            case 'invoice': {
                const result = await prisma.invoice.updateMany({ where: { id, userId }, data: { isDeleted: true } });
                if (result.count === 0) { document = null; break; }
                document = await prisma.invoice.findFirst({ where: { id, userId } });
                break;
            }
            case 'quotation': {
                const result = await prisma.quotation.updateMany({ where: { id, userId }, data: { isDeleted: true } });
                if (result.count === 0) { document = null; break; }
                document = await prisma.quotation.findFirst({ where: { id, userId } });
                break;
            }
            case 'expense': {
                const result = await prisma.expense.updateMany({ where: { id, userId }, data: { isDeleted: true } });
                if (result.count === 0) { document = null; break; }
                document = await prisma.expense.findFirst({ where: { id, userId } });
                break;
            }
            default:
                return res.status(400).json({ success: false, message: 'Invalid document type' });
        }

        if (!document) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }

        res.status(200).json({
            success: true,
            message: `${type} deleted successfully`,
            data: document
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;