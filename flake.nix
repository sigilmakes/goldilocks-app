{
  description = "Goldilocks App — AI-driven DFT input generation";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        nativeBuildInputs = with pkgs; [
          # JS / Node
          nodejs_22
          # Native module build deps (better-sqlite3, bcrypt)
          python3
          gcc
          gnumake
          pkg-config
          # k8s dev workflow
          kind
          kubectl
          tilt
          # Misc
          jq
        ];

        shellHook = ''
          # Put local node_modules/.bin on PATH
          export PATH="$PWD/node_modules/.bin:$PATH"

          echo ""
          echo "  🔮 goldilocks-app dev shell"
          echo ""
          echo "  Local dev:   npm install && npm run dev:both"
          echo "  k8s dev:     npm run dev:setup && tilt up"
          echo "  Typecheck:   npm run typecheck"
          echo ""
        '';
      };
    };
}
