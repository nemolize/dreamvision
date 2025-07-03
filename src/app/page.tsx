import Image from "next/image";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-4">
            Tailwind CSS Demo
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Demonstrating various Tailwind CSS utilities and components
          </p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {/* Card 1 - Colors & Gradients */}
          <div className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow duration-300">
            <div className="w-12 h-12 bg-gradient-to-r from-pink-500 to-violet-500 rounded-lg mb-4"></div>
            <h3 className="text-xl font-semibold text-gray-800 mb-2">
              Colors & Gradients
            </h3>
            <p className="text-gray-600">
              Beautiful gradient backgrounds and color utilities
            </p>
          </div>

          {/* Card 2 - Responsive Design */}
          <div className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow duration-300">
            <div className="w-12 h-12 bg-gradient-to-r from-green-500 to-teal-500 rounded-lg mb-4"></div>
            <h3 className="text-xl font-semibold text-gray-800 mb-2">
              Responsive Design
            </h3>
            <p className="text-gray-600">Mobile-first responsive utilities</p>
          </div>

          {/* Card 3 - Animations */}
          <div className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow duration-300">
            <div className="w-12 h-12 bg-gradient-to-r from-orange-500 to-red-500 rounded-lg mb-4 animate-pulse"></div>
            <h3 className="text-xl font-semibold text-gray-800 mb-2">
              Animations
            </h3>
            <p className="text-gray-600">
              Built-in animation classes like pulse, bounce, etc.
            </p>
          </div>
        </div>

        {/* Interactive Elements */}
        <div className="bg-white rounded-xl shadow-lg p-8 mb-12">
          <h2 className="text-3xl font-bold text-gray-800 mb-6">
            Interactive Elements
          </h2>

          <div className="space-y-6">
            {/* Buttons */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-3">
                Buttons
              </h3>
              <div className="flex flex-wrap gap-3">
                <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                  Primary
                </button>
                <button className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors">
                  Secondary
                </button>
                <button className="px-4 py-2 border border-green-500 text-green-500 rounded-lg hover:bg-green-50 transition-colors">
                  Outline
                </button>
                <button className="px-4 py-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors">
                  Rounded
                </button>
              </div>
            </div>

            {/* Badges */}
            <div>
              <h3 className="text-lg font-semibold text-gray-700 mb-3">
                Badges
              </h3>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                  New
                </span>
                <span className="px-3 py-1 bg-green-100 text-green-800 text-sm font-medium rounded-full">
                  Success
                </span>
                <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-sm font-medium rounded-full">
                  Warning
                </span>
                <span className="px-3 py-1 bg-red-100 text-red-800 text-sm font-medium rounded-full">
                  Error
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Layout Examples */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-3xl font-bold text-gray-800 mb-6">
            Layout Examples
          </h2>

          {/* Flexbox Example */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-700 mb-3">
              Flexbox Layout
            </h3>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 bg-purple-100 p-4 rounded-lg">
                <div className="h-20 bg-purple-300 rounded"></div>
              </div>
              <div className="flex-1 bg-blue-100 p-4 rounded-lg">
                <div className="h-20 bg-blue-300 rounded"></div>
              </div>
              <div className="flex-1 bg-green-100 p-4 rounded-lg">
                <div className="h-20 bg-green-300 rounded"></div>
              </div>
            </div>
          </div>

          {/* Grid Example */}
          <div>
            <h3 className="text-lg font-semibold text-gray-700 mb-3">
              Grid Layout
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((item) => (
                <div
                  key={item}
                  className="bg-gray-200 p-4 rounded-lg text-center"
                >
                  <div className="h-16 bg-gray-400 rounded mb-2"></div>
                  <span className="text-sm text-gray-600">Item {item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-12 py-8 border-t border-gray-200">
          <p className="text-gray-600">
            Tailwind CSS v4.1.11 successfully installed and working! 🎉
          </p>
        </div>
      </div>
    </main>
  );
}
