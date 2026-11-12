import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters long'],
      maxlength: [30, 'Username cannot exceed 30 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        'Please provide a valid email address',
      ],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters long'],
    },
    role: {
      type: String,
      enum: {
        values: ['player', 'admin'],
        message: '{VALUE} is not a valid role',
      },
      default: 'player',
    },
    coins: {
      type: Number,
      default: 0,
      min: [0, 'Coins cannot be negative'],
    },
    totalScore: {
      type: Number,
      default: 0,
      min: [0, 'Total score cannot be negative'],
    },
    currentLevel: {
      type: Number,
      default: 1,
      min: [1, 'Current level must be at least 1'],
    },
    completedLevels: {
      type: [Number],
      default: [],
    },
    totalStars: {
      type: Number,
      default: 0,
      min: [0, 'Total stars cannot be negative'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform(doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Pre-save hook: Modern async middleware without deprecated 'next' callback
userSchema.pre('save', async function () {
  // Only hash password if it was created or modified
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Instance method: Compare incoming plain password with stored bcrypt hash
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

export default User;