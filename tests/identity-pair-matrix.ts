// The identity pair's input matrix, shared by the core, element and
// provider suites: userId ∈ {absent, "", a value} × getEndUserToken ∈
// {absent, present}. Identified only for the whole pair; half-set (worth
// one warning) whenever something was set that is not the whole pair.

const vouch = () => "end-user-token";

// userId ∈ {absent, "", a value} × getEndUserToken ∈ {absent, present}.
export const IDENTITY_PAIR_MATRIX = [
  {
    name: "nothing set",
    userId: undefined,
    vouch: undefined,
    identified: false,
    halfSet: false,
  },
  {
    name: "empty id alone",
    userId: "",
    vouch: undefined,
    identified: false,
    halfSet: true,
  },
  {
    name: "id alone",
    userId: "user-a",
    vouch: undefined,
    identified: false,
    halfSet: true,
  },
  {
    name: "vouch alone",
    userId: undefined,
    vouch,
    identified: false,
    halfSet: true,
  },
  {
    name: "empty id with a vouch",
    userId: "",
    vouch,
    identified: false,
    halfSet: true,
  },
  {
    name: "the whole pair",
    userId: "user-a",
    vouch,
    identified: true,
    halfSet: false,
  },
] as const;
