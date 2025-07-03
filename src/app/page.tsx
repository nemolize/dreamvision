import { FluidCanvas } from "@/components/fluid-canvas";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-4">
            2D Fluid Simulation
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Interactive fluid dynamics simulation using the Navier-Stokes
            equations
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">
            Fluid Simulation
          </h2>
          <FluidCanvas width={120} height={80} scale={6} />
        </div>
      </div>
    </main>
  );
}
