// The subscription-connect surfaces. The shapes are generated
// from serving-openapi.json; this file keeps the package's public names
// stable over the generated ones.

export type {
  CreateDeviceAuthorizationResponse as SubscriptionDeviceAuthorization,
  PollDeviceAuthorizationResponse as SubscriptionDeviceAuthorizationPoll,
  ServingSubscriptionStatus as SubscriptionStatus,
  SubscriptionCredentialState,
  SubscriptionProvider,
} from "../generated/models/index.js";
