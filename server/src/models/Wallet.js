import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required for a wallet'],
      unique: true,
      index: true,
    },
    balance: {
      type: Number,
      required: [true, 'Wallet balance is required'],
      default: 0,
      min: [0, 'Wallet balance cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Wallet balance must be an integer',
      },
    },
    currency: {
      type: String,
      default: 'COIN',
      uppercase: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

walletSchema.index({ balance: 1 });

const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', walletSchema);

export default Wallet;