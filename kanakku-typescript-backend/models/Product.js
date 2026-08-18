const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    item_type: {
        type: String,
        enum: ['Product', 'Service'],
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    code: {
        type: String,
        required: true,
        unique: true
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    },
    brand: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Brand',
        required: true
    },
    unit: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Unit',
        required: true
    },
    selling_price: {
        type: Number,
        required: true
    },
    purchase_price: {
        type: Number,
        required: true
    },
    discount_type: {
        type: String,
        required: true
    },
    discount_value: {
        type: Number,
        required: true
    },
    tax: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaxGroup',
        required: true
    },
    barcode: {
        type: String,
        required: true,
        unique: true
    },
    alert_quantity: {
        type: Number,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    product_image: {
        type: String,
        required: true
    },
    gallery_images: [
        { type: String }
    ],
    enable_inventory: {
        type: Boolean,
        default: false
    },
    stock: {
        type: Number,
        default: 0
    },
    status: {
        type: Boolean,
        default: true
    }
},
{
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

productSchema.virtual('productImageUrl').get(function () {
    if (this.product_image) {
        return `${process.env.BASE_URL}${this.product_image}`;
    }
});

module.exports = mongoose.model('Product', productSchema);
