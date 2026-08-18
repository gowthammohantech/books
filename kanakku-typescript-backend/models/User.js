const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      required: false,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    phone: {
      type: String,
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
    },
    dateOfBirth: {
      type: Date,
    },
    password: {
      type: String,
      required: true,
    },
    profileImage: {
      type: String,
    },
    address: {
      type: String,
    },
    country: {
      type: mongoose.Schema.Types.Int32,
      ref: 'Country',
    },
    state: {
      type: mongoose.Schema.Types.Int32,
      ref: 'State',
    },
    city: {
      type: mongoose.Schema.Types.Int32,
      ref: 'City',
    },
    postalCode: {
      type: String,
    },
    user_type: {
      type: Number,
      required: true,
      default: 1,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      default: null,
    },
    balance: {
      type: Number,
      default: 0,
    },
    balance_type: {
      type: String,
      enum: ['credit', 'debit'],
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.virtual('profileImageUrl').get(function () {
  const baseUrl = process.env.BASE_URL;
  return this.profileImage ? `${baseUrl}/${this.profileImage}` : '';
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};


userSchema.methods.softDelete = async function () {
  this.isDeleted = true;
  this.deletedAt = new Date();
  await this.save();
};

module.exports = mongoose.model('User', userSchema);
